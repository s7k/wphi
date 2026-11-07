//! 1キャラ分のレガシーサーバへの接続。
//!
//! 受信行は `phi_proto::Parser` で解析して UI へ送り、`#lag` などの自動応答はここで返す。
//! 送信も受信も1つのタスクが持つ。

use std::time::Duration;

use phi_proto::{
    Event, LineBuffer, Parser, codec,
    parser::{Channel, InternalAction, Message},
    tag_to_html::{LogOptions, to_html},
};
use serde::Serialize;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::mpsc,
    time::{Instant, timeout, timeout_at},
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// 無受信がこの時間続いたら `#code-sjis` を送る(Philly の DISCONNECT_CHECK_TIME)。
const KEEPALIVE_AFTER: Duration = Duration::from_secs(2 * 60);
/// 無受信がこの時間続いたら UI に警告を出す(Philly の DISCONNECT_WARNING_TIME)。
const WARN_AFTER: Duration = Duration::from_secs(3 * 60);
/// 世界移動の各段階で返事を待つ時間(Philly の classTransportCharacter::TimeoutMs)。
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(300);

/// UI へ送るイベント。ログの行は `Event::Message` の代わりに HTML にした `log` を送る。
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum UiEvent {
    Proto(Event),
    Ui(UiOnly),
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UiOnly {
    Log {
        channel: Channel,
        html: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        from: Option<String>,
    },
    /// 接続できない、切れた、応答が無いなど。
    Error { message: String },
    /// 世界移動が済み、接続先が変わった。登録したキャラの接続先もこれで書き換える。
    WorldMoved { host: String, port: u16 },
}

pub struct Login {
    pub host: String,
    pub port: u16,
    pub id: String,
}

/// Philly のログイン時の送信(CharacterCommon.cpp `LoginCommand`)。値は Philly の既定値。
/// 世界移動の後は `#open` を送らない(移動先へは `#reserve` で ID を渡してある)。
fn login_lines(id: Option<&str>) -> Vec<String> {
    let open = id.map(|id| format!("#open {id}"));
    open.into_iter()
        .chain([
            "#version-cli 05107100".into(),
            // 0.1 秒単位(Philly.ini の MapUpdateTime / StatusUpdateTime)
            "#map-iv 2".into(),
            "#status-iv 2".into(),
            "#ex-switch eagleeye=form".into(),
            "#ex-map size=57".into(),
            "#ex-map style=solid".into(),
            "#ex-switch ex-move-recv=true".into(),
            "#ex-switch ex-list-mode-end=true".into(),
            "#ex-switch ex-disp-magic=false".into(),
            // 朱蓮の絶対座標(v5y の :U ZA 拡張)。他の世界は =false を返す
            "#ex-switch ex-abspos=true".into(),
        ])
        .collect()
}

fn line_bytes(text: &str) -> Vec<u8> {
    let mut b = codec::encode(text);
    b.push(b'\n');
    b
}

/// 接続し、切れるまで送受信を続ける。`outgoing` が閉じたら `#x` を送って切る。
pub async fn run(login: Login, mut outgoing: mpsc::Receiver<String>, mut emit: impl FnMut(UiEvent)) {
    let addr = (login.host.as_str(), login.port);
    let mut stream = match timeout(CONNECT_TIMEOUT, TcpStream::connect(addr)).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => return emit(error(format!("接続出来ません: {e}"))),
        Err(_) => return emit(error("接続がタイムアウトしました".into())),
    };
    let login_bytes: Vec<u8> = login_lines(Some(&login.id))
        .iter()
        .flat_map(|l| line_bytes(l))
        .collect();
    if let Err(e) = stream.write_all(&login_bytes).await {
        return emit(error(format!("送信に失敗しました: {e}")));
    }

    let mut lines = LineBuffer::new();
    let mut parser = Parser::new();
    let opts = LogOptions::default();
    let mut buf = vec![0u8; 32 * 1024];
    let mut last_recv = Instant::now();
    let mut keepalive_sent = false;
    let mut warned = false;

    loop {
        let wake = if keepalive_sent {
            last_recv + WARN_AFTER
        } else {
            last_recv + KEEPALIVE_AFTER
        };
        let mut reply: Vec<String> = Vec::new();
        tokio::select! {
            r = stream.read(&mut buf) => {
                let n = match r {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(e) => {
                        emit(error(format!("受信に失敗しました: {e}")));
                        break;
                    }
                };
                last_recv = Instant::now();
                keepalive_sent = false;
                warned = false;
                let mut moving_to = None;
                'lines: for line in lines.feed(&buf[..n]) {
                    for ev in parser.feed(&line) {
                        match ev {
                            Event::Internal { action: InternalAction::Lag } => reply.push("#end-lag".into()),
                            Event::Internal { action: InternalAction::Remap } => reply.push("#map".into()),
                            Event::Message(m) => emit(log_event(m, &opts)),
                            Event::WorldTransfer { ref server, .. } => {
                                moving_to = Some(server.clone());
                                emit(UiEvent::Proto(ev));
                                break 'lines;
                            }
                            ev => emit(UiEvent::Proto(ev)),
                        }
                    }
                }
                if let Some(server) = moving_to {
                    if !reply.is_empty() {
                        let bytes: Vec<u8> = reply.drain(..).flat_map(|l| line_bytes(&l)).collect();
                        let _ = stream.write_all(&bytes).await;
                    }
                    if let Some(dst) = transfer(&mut stream, &mut lines, &server, &login.id, &mut emit).await {
                        // 移動元で受けていた残りの行は捨てる(Philly も ChSrv の成功で受信の処理を打ち切る)
                        stream = dst;
                        lines = LineBuffer::new();
                        parser = Parser::new();
                        // 移動中に UI から送られた行は捨てる(Philly の RejectMainThreadSend)
                        while outgoing.try_recv().is_ok() {}
                    }
                    last_recv = Instant::now();
                }
            }
            text = outgoing.recv() => match text {
                Some(text) => reply.push(text),
                None => {
                    let _ = stream.write_all(&line_bytes("#x")).await;
                    return;
                }
            },
            _ = tokio::time::sleep_until(wake) => {
                if !keepalive_sent {
                    reply.push("#code-sjis".into());
                    keepalive_sent = true;
                } else if !warned {
                    warned = true;
                    emit(error("サーバから3分間応答がありません".into()));
                }
            }
        }
        let bytes: Vec<u8> = reply.iter().flat_map(|l| line_bytes(l)).collect();
        if !bytes.is_empty()
            && let Err(e) = stream.write_all(&bytes).await
        {
            emit(error(format!("送信に失敗しました: {e}")));
            break;
        }
    }
    emit(UiEvent::Proto(Event::Connection {
        state: phi_proto::parser::ConnectionState::Closed,
    }));
}

/// 世界移動(Philly の PersonalThread.cpp classTransportCharacter::ChSrv)。成功したら移動先の接続を返す。
///
/// 移動先へ `#reserve <ID>` → `#rsv-ok` を待つ → 移動元へ `#trans <IP> <ポート>` → `#trs-ok` を待つ →
/// 移動先へ `#ch-srv-ok` → 移動先へログイン時の設定(`#open` なし)。
/// 失敗したら移動元へ `#no-srv`(移動先に繋がらない時)か `#ch-srv-no`(移動元が断った時)を送り、移動元のまま続ける。
async fn transfer(
    src: &mut TcpStream,
    src_lines: &mut LineBuffer,
    server: &str,
    id: &str,
    emit: &mut impl FnMut(UiEvent),
) -> Option<TcpStream> {
    let (host, port) = server.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;
    let deadline = || Instant::now() + TRANSFER_TIMEOUT;

    emit(system(true, "転送先世界へゲート接続開始..."));
    let mut dst = match timeout(CONNECT_TIMEOUT, TcpStream::connect((host, port))).await {
        Ok(Ok(s)) => s,
        _ => {
            emit(system(false, "転送先の世界が見つかりません"));
            let _ = src.write_all(&line_bytes("#no-srv")).await;
            return None;
        }
    };

    emit(system(true, "転送先世界に転送準備要求..."));
    let mut dst_lines = LineBuffer::new();
    let reserved = dst.write_all(&line_bytes(&format!("#reserve {id}"))).await.is_ok()
        && wait_line(&mut dst, &mut dst_lines, b"#rsv-ok", &[b"#rsv-no", b"#x"], deadline()).await;
    if !reserved {
        let _ = src.write_all(&line_bytes("#no-srv")).await;
        emit(system(
            false,
            "転送準備失敗。転送先の世界で同時接続数をオーバーしている可能性があります。",
        ));
        return None;
    }

    emit(system(true, "転送元世界に転送要求..."));
    let trans = format!("#trans {host} {port}");
    let accepted = src.write_all(&line_bytes(&trans)).await.is_ok()
        && wait_line(src, src_lines, b"#trs-ok", &[b"#trs-no"], deadline()).await;
    if !accepted {
        let _ = src.write_all(&line_bytes("#ch-srv-no")).await;
        emit(system(false, "転送失敗"));
        return None;
    }
    let after: Vec<u8> = ["#ch-srv-ok".to_string()]
        .into_iter()
        .chain(login_lines(None))
        .flat_map(|l| line_bytes(&l))
        .collect();
    if dst.write_all(&after).await.is_err() {
        emit(system(false, "転送先世界への送信に失敗しました"));
        return None;
    }
    emit(system(true, "転送完了"));
    emit(UiEvent::Ui(UiOnly::WorldMoved {
        host: host.to_string(),
        port,
    }));
    Some(dst)
}

/// `ok` の行が来たら true、`ng` の行が来るか、切れるか、`deadline` を過ぎたら false。他の行は読み捨てる。
async fn wait_line(stream: &mut TcpStream, lines: &mut LineBuffer, ok: &[u8], ng: &[&[u8]], deadline: Instant) -> bool {
    let mut buf = [0u8; 4096];
    loop {
        let n = match timeout_at(deadline, stream.read(&mut buf)).await {
            Ok(Ok(n)) if n > 0 => n,
            _ => return false,
        };
        for line in lines.feed(&buf[..n]) {
            if line == ok {
                return true;
            }
            if ng.contains(&line.as_slice()) {
                return false;
            }
        }
    }
}

/// クライアントが出すログの行(Philly の AddSysMessageOk / AddSysMessageNg)。
fn system(ok: bool, text: &str) -> UiEvent {
    let class = if ok { "class_system_ok" } else { "class_system_ng" };
    let text = text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    UiEvent::Ui(UiOnly::Log {
        channel: Channel::System,
        html: format!(r#"<font class="{class}">{text}</font>"#),
        from: None,
    })
}

fn log_event(m: Message, opts: &LogOptions) -> UiEvent {
    UiEvent::Ui(UiOnly::Log {
        channel: m.channel,
        html: to_html(&m.text, opts),
        from: m.from,
    })
}

fn error(message: String) -> UiEvent {
    UiEvent::Ui(UiOnly::Error { message })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use tokio::{
        io::{AsyncBufReadExt, BufReader},
        net::TcpListener,
    };

    /// 偽サーバに繋ぎ、ログインの送信、#lag への応答、送信の cp932 化、ログの HTML 化、切断を確かめる。
    #[tokio::test]
    async fn talks_to_server() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            let mut read_line = async || {
                let mut l = Vec::new();
                r.read_until(b'\n', &mut l).await.unwrap();
                l
            };
            let mut got = Vec::new();
            for _ in 0..login_lines(Some("ID")).len() {
                got.push(read_line().await);
            }
            // 2バイト文字の途中で分けて送る
            let mut talk = codec::encode("勇者 > /*cl=red*/こんにちは/*.*/\n");
            let rest = talk.split_off(5);
            w.write_all(&talk).await.unwrap();
            w.write_all(&rest).await.unwrap();
            w.write_all(b"#lag\n").await.unwrap();
            // 応答の #end-lag と UI からの送信を受け取る(順序は問わない)
            let mut after = vec![read_line().await, read_line().await];
            after.sort();
            w.write_all(b"#x\n").await.unwrap();
            (got, after)
        });

        let (tx, rx) = mpsc::channel(8);
        tx.send("say あ😀".into()).await.unwrap();
        let mut events: Vec<Value> = Vec::new();
        run(
            Login {
                host: "127.0.0.1".into(),
                port,
                id: "ID".into(),
            },
            rx,
            |ev| events.push(serde_json::to_value(ev).unwrap()),
        )
        .await;

        let (login, after) = server.await.unwrap();
        assert_eq!(login[0], b"#open ID\n");
        assert_eq!(login.last().unwrap(), b"#ex-switch ex-abspos=true\n");
        assert_eq!(after, vec![b"#end-lag\n".to_vec(), b"say \x82\xa0?\n".to_vec()]);
        assert_eq!(
            events,
            vec![
                json!({"type": "log", "channel": "log",
                       "html": "<font class=\"class_name\">勇者</font> &gt; <font class=\"cl_red\" style=\"color:red;\">こんにちは</font>"}),
                json!({"type": "connection", "state": "closed"}),
                json!({"type": "connection", "state": "closed"}),
            ]
        );
        drop(tx);
    }

    async fn read_line(r: &mut BufReader<tokio::net::tcp::OwnedReadHalf>) -> String {
        let mut l = Vec::new();
        r.read_until(b'\n', &mut l).await.unwrap();
        String::from_utf8(l).unwrap()
    }

    /// 移動元と移動先の偽サーバで、世界移動の手順を確かめる。
    /// `rsv` は移動先が #reserve に返す行。#rsv-ok なら成功、#rsv-no なら失敗の手順になる。
    async fn world_transfer(rsv: &'static str) -> (Vec<String>, Vec<String>, Vec<Value>) {
        let dst_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dst_port = dst_listener.local_addr().unwrap().port();
        let src_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let src_port = src_listener.local_addr().unwrap().port();

        let dst = tokio::spawn(async move {
            let (sock, _) = dst_listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            let mut got = vec![read_line(&mut r).await];
            w.write_all(format!("{rsv}\n").as_bytes()).await.unwrap();
            if rsv == "#rsv-ok" {
                // #ch-srv-ok と、#open の無いログイン時の設定
                for _ in 0..login_lines(None).len() + 1 {
                    got.push(read_line(&mut r).await);
                }
                w.write_all(b"#x\n").await.unwrap();
            }
            got
        });
        let src = tokio::spawn(async move {
            let (sock, _) = src_listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            for _ in 0..login_lines(Some("ID")).len() {
                read_line(&mut r).await;
            }
            w.write_all(format!("#ch-srv 127.0.0.1 {dst_port}\n#name 捨てる行\n").as_bytes())
                .await
                .unwrap();
            let mut got = vec![read_line(&mut r).await];
            if got[0].starts_with("#trans") {
                w.write_all(b"#trs-ok\n").await.unwrap();
            } else {
                // 失敗した時は移動元のまま続く
                w.write_all(b"#x\n").await.unwrap();
                drop(w);
                got.push(read_line(&mut r).await);
            }
            got
        });

        let (tx, rx) = mpsc::channel(8);
        let mut events: Vec<Value> = Vec::new();
        run(
            Login {
                host: "127.0.0.1".into(),
                port: src_port,
                id: "ID".into(),
            },
            rx,
            |ev| events.push(serde_json::to_value(ev).unwrap()),
        )
        .await;
        drop(tx);
        (src.await.unwrap(), dst.await.unwrap(), events)
    }

    #[tokio::test]
    async fn world_transfer_succeeds() {
        let (src, dst, events) = world_transfer("#rsv-ok").await;
        assert_eq!(src[0], format!("#trans 127.0.0.1 {}\n", dst_port_of(&events)));
        assert_eq!(dst[0], "#reserve ID\n");
        assert_eq!(dst[1], "#ch-srv-ok\n");
        assert_eq!(dst[2], "#version-cli 05107100\n");
        assert!(!dst.iter().any(|l| l.starts_with("#open")));
        // 移動元の #ch-srv の後の行は捨てる
        assert!(!events.iter().any(|e| e["name"] == "捨てる行"));
        assert!(
            events
                .iter()
                .any(|e| e["type"] == "worldMoved" && e["host"] == "127.0.0.1")
        );
    }

    #[tokio::test]
    async fn world_transfer_fails_on_rsv_no() {
        let (src, _dst, events) = world_transfer("#rsv-no").await;
        assert_eq!(src[0], "#no-srv\n");
        assert!(!events.iter().any(|e| e["type"] == "worldMoved"));
    }

    fn dst_port_of(events: &[Value]) -> u64 {
        events.iter().find(|e| e["type"] == "worldMoved").unwrap()["port"]
            .as_u64()
            .unwrap()
    }
}
