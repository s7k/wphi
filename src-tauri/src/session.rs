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
    time::{Instant, timeout},
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// 無受信がこの時間続いたら `#code-sjis` を送る(Philly の DISCONNECT_CHECK_TIME)。
const KEEPALIVE_AFTER: Duration = Duration::from_secs(2 * 60);
/// 無受信がこの時間続いたら UI に警告を出す(Philly の DISCONNECT_WARNING_TIME)。
const WARN_AFTER: Duration = Duration::from_secs(3 * 60);

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
}

pub struct Login {
    pub host: String,
    pub port: u16,
    pub id: String,
}

/// Philly のログイン時の送信(CharacterCommon.cpp `LoginCommand`)。値は Philly の既定値。
fn login_lines(id: &str) -> Vec<String> {
    vec![
        format!("#open {id}"),
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
    ]
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
    let login_bytes: Vec<u8> = login_lines(&login.id).iter().flat_map(|l| line_bytes(l)).collect();
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
                for line in lines.feed(&buf[..n]) {
                    for ev in parser.feed(&line) {
                        match ev {
                            Event::Internal { action: InternalAction::Lag } => reply.push("#end-lag".into()),
                            Event::Internal { action: InternalAction::Remap } => reply.push("#map".into()),
                            Event::Message(m) => emit(log_event(m, &opts)),
                            ev => emit(UiEvent::Proto(ev)),
                        }
                    }
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
            for _ in 0..login_lines("ID").len() {
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
}
