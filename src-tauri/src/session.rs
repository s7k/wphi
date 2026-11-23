//! 1キャラ分のレガシーサーバへの接続。
//!
//! 受信行は `phi_proto::Parser` で解析して UI へ送り、`#lag` などの自動応答はここで返す。
//! 送信も受信も1つのタスクが持つ。

use std::collections::VecDeque;
use std::time::Duration;

use phi_proto::{
    Event, LineBuffer, Parser, codec,
    parser::{Channel, InternalAction, Message},
    tag_to_html::{LogOptions, to_html},
};
use serde::Serialize;

use crate::auto_unequip::{AutoUnequip, strip_tags};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::mpsc,
    time::{Instant, timeout, timeout_at},
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// 送信の期限。相手が読まずに送信バッファが埋まると、受信も切断も止まる(#72)
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);
/// 無受信がこの時間続いたら `#code-sjis` を送る。Philly の DISCONNECT_CHECK_TIME は 2 分だったが、
/// 切れたのを早く見つけて繋ぎ直す為に短くする (#179)
const KEEPALIVE_AFTER: Duration = Duration::from_secs(15);
/// `#code-sjis` に `#code-sjis-ok` を返すサーバで、`#code-sjis` を送った後この時間何も届かなければ、切れたとみなす (#179)。
/// 返事をしないサーバ (古い v5y) では使わず、WARN_AFTER で警告を出すだけにする
const DEAD_AFTER: Duration = Duration::from_secs(20);
/// 無受信がこの時間続いたら UI に警告を出す(Philly の DISCONNECT_WARNING_TIME)。
const WARN_AFTER: Duration = Duration::from_secs(3 * 60);
/// 世界移動の各段階で返事を待つ時間(Philly の classTransportCharacter::TimeoutMs)。
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(300);
/// 世界移動の確かめへの UI の答え。送信キューで届き、サーバへは送らない(#51)
pub const TRANSFER_YES: &str = "#wphi-transfer yes";
pub const TRANSFER_NO: &str = "#wphi-transfer no";
/// 地図の窓から決めた視界の大きさ(`#wphi-view W H`)。送信キューで届き、サーバへは送らない。
/// セッションが覚え、型に合わせた `#ex-map view=` に直して送る
pub const VIEW_PREFIX: &str = "#wphi-view ";
/// UI からセッションへの内部行の頭。どの時点で届いてもサーバへは送らない
const INTERNAL_PREFIX: &str = "#wphi-";

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
        /// 元の受信テキスト。効果音の照合に使い、UI には送らない。照合しない行は空
        #[serde(skip)]
        text: String,
        /// 元の行(PHI のタグ付き)。ログ欄の「タグ付きでコピー」などに使う(#81)
        #[serde(skip_serializing_if = "String::is_empty")]
        raw: String,
        /// 発言の種類 (#v6 T。#190)
        #[serde(skip_serializing_if = "Option::is_none")]
        speech: Option<String>,
        /// タスクバーを点滅させない行(Philly の NotFlashRegexp)。main.rs が決める
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        no_flash: bool,
    },
    /// 効果音を鳴らす(Philly の SoundPlay)。file が false ならタスクバーの点滅
    Sound { no: usize, file: bool },
    /// 接続できない、切れた、応答が無いなど。
    Error { message: String },
    /// 世界移動が済み、接続先が変わった。登録したキャラの接続先もこれで書き換える。
    WorldMoved { host: String, port: u16 },
    /// 今と違うホストへの世界移動を確かめる。UI は TRANSFER_YES か TRANSFER_NO を送る(#51)
    ConfirmTransfer { host: String, port: u16 },
    /// 世界移動の確かめの答えを TRANSFER_TIMEOUT まで待っても来ないので、移動をやめた。UI は確かめの窓を閉じる(#153)
    TransferExpired,
}

pub struct Login {
    pub host: String,
    pub port: u16,
    pub id: String,
    /// 要求する視界の大きさ(v6)。地図の窓がまだ大きさを決めていなければ None
    pub view: Option<(u8, u8)>,
}

/// Philly のログイン時の送信(CharacterCommon.cpp `LoginCommand`)。値は Philly の既定値。
/// 世界移動の後は `#open` を送らない(移動先へは `#reserve` で ID を渡してある)。
/// サーバは世界移動のたびに v6 の大きさを消すので、移動の後も `#ex-map view=` を送り直す。型は北固定から始まる
fn login_lines(id: Option<&str>, view: Option<(u8, u8)>) -> Vec<String> {
    let open = id.map(|id| format!("#open {id}"));
    let view = view.map(|v| view_line(v, false));
    open.into_iter()
        .chain([
            "#version-cli 05107100".into(),
            // 0.1 秒単位(Philly.ini の MapUpdateTime / StatusUpdateTime)
            "#map-iv 2".into(),
            "#status-iv 2".into(),
            "#ex-switch eagleeye=form".into(),
            "#ex-map size=57".into(),
            "#ex-map style=solid".into(),
        ])
        .chain(view)
        .chain([
            "#ex-switch ex-move-recv=true".into(),
            "#ex-switch ex-list-mode-end=true".into(),
            "#ex-switch ex-disp-magic=false".into(),
            // 朱蓮の絶対座標(v5y の :U ZA 拡張)。他の世界は =false を返す
            "#ex-switch ex-abspos=true".into(),
            // v6 のサーバは返事の行の後ろから deflate で送る(phi_dm の docs/dev/protocol-v6.md の「通信の圧縮」)。他のサーバは読み捨てる
            "#ex-switch compress=deflate".into(),
        ])
        .collect()
}

/// v6 の視界の要求。窓より上下左右に VIEW_MARGIN マスずつ多く求め、外周は窓の外に置く(ui/src/mapRender.ts の viewArea)。
/// スムーズ移動で地図をずらした時に、窓に入る端を描く為。回転はサーバが正方形しか受け付けないので、小さい方に揃えて送る
/// 窓に見せる範囲の外に、上下左右に余分に受けるマス数
const VIEW_MARGIN: u8 = 3;

fn view_line((w, h): (u8, u8), turn: bool) -> String {
    let (w, h) = if turn { (w.min(h), w.min(h)) } else { (w, h) };
    // 外周を VIEW_MARGIN マスずつ足す。返事を待たずに先へ進む歩み (walker.ts の MAX_UNCONFIRMED) の分だけ、
    // 予想で地図をずらしても窓の端に ? が出ない (#180)。行番号と座標が 10 進 2 桁なので、99 まで
    let m = 2 * VIEW_MARGIN;
    let (w, h) = (w.min(99 - m) + m, h.min(99 - m) + m);
    // mapsets=16 はマップセットを 16 枠で受ける印(phi_dm の #v6 A と #v6 D)。view= より前に置く。知らないサーバは読み捨てる
    format!("#ex-map mapsets=16 view={w} {h}")
}

/// `#wphi-view W H` なら、その大きさを `view` に覚える。世界移動の確かめと移動の間も覚え、移動の後に送る(#153)
fn keep_view(text: &str, view: &mut Option<(u8, u8)>) {
    if let Some(v) = parse_view(text) {
        *view = Some(v);
    }
}

/// `#wphi-view W H` の大きさ
fn parse_view(text: &str) -> Option<(u8, u8)> {
    let (w, h) = text.strip_prefix(VIEW_PREFIX)?.split_once(' ')?;
    Some((w.parse().ok()?, h.parse().ok()?))
}

/// サーバの `#ex-switch compress=deflate` の返事。この行の後ろから deflate で届く
const COMPRESS_MARK: &[u8] = b"\n#ex-switch compress=deflate\n";

/// 受けたバイト列を、サーバが圧縮を始めていれば展開する
struct Inflate {
    /// 圧縮が始まるまでの、前に受けた分の末尾。返事の行が2回の受信に跨った時の為。最初は行頭を表す `\n`
    tail: Vec<u8>,
    z: Option<flate2::Decompress>,
}

impl Inflate {
    fn new() -> Self {
        Self {
            tail: b"\n".to_vec(),
            z: None,
        }
    }

    fn feed(&mut self, raw: &[u8]) -> Result<Vec<u8>, String> {
        let Some(z) = self.z.as_mut() else {
            let mut all = std::mem::take(&mut self.tail);
            let skip = all.len();
            all.extend_from_slice(raw);
            if let Some(i) = all.windows(COMPRESS_MARK.len()).position(|w| w == COMPRESS_MARK) {
                // tail は印より短いので、印の終わりは今回の分の中にある
                let end = i + COMPRESS_MARK.len() - skip;
                self.z = Some(flate2::Decompress::new(true));
                let mut out = raw[..end].to_vec();
                out.extend(self.feed(&raw[end..])?);
                return Ok(out);
            }
            self.tail = all[all.len().saturating_sub(COMPRESS_MARK.len() - 1)..].to_vec();
            return Ok(raw.to_vec());
        };
        let mut out = Vec::new();
        let mut pos = 0;
        loop {
            out.reserve(raw.len() * 4 + 4096);
            let (before, before_out) = (z.total_in(), out.len());
            let st = z
                .decompress_vec(&raw[pos..], &mut out, flate2::FlushDecompress::Sync)
                .map_err(|e| e.to_string())?;
            pos += (z.total_in() - before) as usize;
            // 圧縮の終わり (StreamEnd) の後ろにバイトが来ると、入力も出力も進まずに回り続ける (#124)。
            // phi_dm は終わらせずに送り続けるので、終わりが来たら壊れた流れとして切る
            if st == flate2::Status::StreamEnd && pos < raw.len()
                || (pos < raw.len() && out.len() == before_out && z.total_in() == before)
            {
                return Err("圧縮した流れの後ろに余分なデータがあります".into());
            }
            // 出力の領域が余ったまま返ったら、届いた分を出し切っている
            if pos == raw.len() && out.len() < out.capacity() {
                return Ok(out);
            }
        }
    }
}

fn line_bytes(text: &str) -> Vec<u8> {
    let mut b = codec::encode(text);
    b.push(b'\n');
    b
}

/// 無応答の時に次に起きる時刻。2分で #code-sjis を送り、3分で警告する。警告の後は None(待たない)
fn next_wake(last_recv: Instant, keepalive_sent: bool, warned: bool, answers: bool) -> Option<Instant> {
    match (keepalive_sent, warned) {
        (_, true) => None,
        (true, false) if answers => Some(last_recv + KEEPALIVE_AFTER + DEAD_AFTER),
        (true, false) => Some(last_recv + WARN_AFTER),
        (false, false) => Some(last_recv + KEEPALIVE_AFTER),
    }
}

/// 1行ずつの小さな送受信を待たせない。
/// サーバ(v5y)は Nagle を切っていないので、前に送った分の ACK が来るまで次の地図を送らない。
/// 受ける側が遅延 ACK で待つと、地図の続きの行が遅れる。Windows は最大 200ms、Linux も
/// やり取りが続くと 200ms 近くまで延びる(トレースでは #m57 の1行目と残りの間が 125〜164ms 空いた)。
/// 遅延 ACK は、Windows は SIO_TCP_SET_ACK_FREQUENCY で、Linux は TCP_QUICKACK(受けるたびに戻るので quickack)で切る
fn tune(stream: &TcpStream) {
    let _ = stream.set_nodelay(true);
    quickack(stream);
    #[cfg(windows)]
    unsafe {
        use std::os::windows::io::AsRawSocket;
        use windows_sys::Win32::Networking::WinSock::{SIO_TCP_SET_ACK_FREQUENCY, WSAIoctl};
        let freq: u32 = 1;
        let mut returned = 0u32;
        WSAIoctl(
            stream.as_raw_socket() as _,
            SIO_TCP_SET_ACK_FREQUENCY,
            &freq as *const u32 as _,
            4,
            std::ptr::null_mut(),
            0,
            &mut returned,
            std::ptr::null_mut(),
            None,
        );
    }
}

/// Linux の TCP_QUICKACK。カーネルが勝手に戻すので、受けるたびに付け直す
fn quickack(stream: &TcpStream) {
    #[cfg(target_os = "linux")]
    unsafe {
        use std::os::fd::AsRawFd;
        let on: libc::c_int = 1;
        libc::setsockopt(
            stream.as_raw_fd(),
            libc::IPPROTO_TCP,
            libc::TCP_QUICKACK,
            &on as *const libc::c_int as _,
            std::mem::size_of::<libc::c_int>() as _,
        );
    }
    #[cfg(not(target_os = "linux"))]
    let _ = stream;
}

/// 通信の量と往復の時間 (#197)。時刻の記録 (trace) を取っている時だけ、1 秒ごとに書く。
/// raw は回線で受けたバイト数 (圧縮の前)、data は展開した後。rtt は go を送ってから #v6 G が届くまで
#[derive(Default)]
struct NetStats {
    raw: usize,
    data: usize,
    sent: usize,
    gos: VecDeque<Instant>,
    rtts: Vec<Duration>,
    since: Option<Instant>,
}

impl NetStats {
    fn sent_go(&mut self, now: Instant) {
        if self.gos.len() < 32 {
            self.gos.push_back(now);
        }
    }

    fn moved(&mut self, now: Instant) {
        if let Some(t) = self.gos.pop_front() {
            self.rtts.push(now.duration_since(t));
        }
    }

    /// 1 秒経っていれば 1 行書いて数え直す
    fn flush(&mut self, now: Instant) {
        let since = *self.since.get_or_insert(now);
        if now.duration_since(since) < Duration::from_secs(1) {
            return;
        }
        let rtt = if self.rtts.is_empty() {
            "-".to_string()
        } else {
            let mut v: Vec<u128> = self.rtts.iter().map(|d| d.as_millis()).collect();
            v.sort_unstable();
            format!("{}ms(中央) {}ms(最大) n={}", v[v.len() / 2], v[v.len() - 1], v.len())
        };
        crate::trace::write(&format!("net recv={}B/s 展開後={}B/s send={}B/s rtt={rtt}", self.raw, self.data, self.sent));
        *self = Self { gos: std::mem::take(&mut self.gos), since: Some(now), ..Self::default() };
    }
}

/// 攻撃の待ちの間に押した hit の予約 (#177)。DM は待ちの間に hit を受けると「まだ攻撃できない」を返し、
/// 待ちを 0.2 秒延ばすので、連打するほど遅くなっていた。待ちの間の hit は 1 回だけ覚え、`#end-at` で送る
#[derive(Default)]
struct HitGate {
    /// 覚えた時刻。待ちが明けないまま HIT_HOLD_MAX 過ぎたら、明けたとみなして送る
    held: Option<Instant>,
}

/// 予約した hit を待つ上限。武器の重い攻撃の待ちより長く取る
const HIT_HOLD_MAX: Duration = Duration::from_secs(4);

impl HitGate {
    /// `text` が攻撃の待ちの間の hit なら覚えて true (送らない)
    fn hold(&mut self, text: &str, attacking: bool, now: Instant) -> bool {
        if text.trim() != "hit" || !attacking {
            return false;
        }
        self.held.get_or_insert(now);
        true
    }

    /// 覚えた hit を今送るか。待ちが明けたか、待ち過ぎた時に true
    fn release(&mut self, attacking: bool, now: Instant) -> bool {
        match self.held {
            Some(t) if !attacking || now.duration_since(t) >= HIT_HOLD_MAX => {
                self.held = None;
                true
            }
            _ => false,
        }
    }
}

/// 繋いでいるサーバとの接続。世界移動に成功したら移動先の物に作り直す
struct Conn {
    stream: TcpStream,
    lines: LineBuffer,
    inflate: Inflate,
    parser: Parser,
    /// 今繋いでいるホスト。世界移動で変わる
    host: String,
    /// 最後に送った `#ex-map view=`。型が変わった時(北固定から回転へなど)と、窓の大きさが変わった時に送り直す
    sent_view: Option<String>,
    /// v6 の地図を受けて `#map-iv 1` を送ったか (#194)
    fast_map: bool,
}

impl Conn {
    fn new(stream: TcpStream, host: String, view: Option<(u8, u8)>) -> Self {
        Self {
            stream,
            lines: LineBuffer::new(),
            inflate: Inflate::new(),
            parser: Parser::new(),
            host,
            sent_view: view.map(|v| view_line(v, false)),
            fast_map: false,
        }
    }
}

/// 繋いでログイン時の行を送る。失敗したらエラーを UI に送って None
async fn connect(login: &Login, emit: &mut impl FnMut(UiEvent)) -> Option<Conn> {
    let addr = (login.host.as_str(), login.port);
    let mut stream = match timeout(CONNECT_TIMEOUT, TcpStream::connect(addr)).await {
        Ok(Ok(s)) => {
            tune(&s);
            s
        }
        Ok(Err(e)) => {
            emit(error(format!("接続出来ません: {e}")));
            return None;
        }
        Err(_) => {
            emit(error("接続がタイムアウトしました".into()));
            return None;
        }
    };
    let login_bytes: Vec<u8> = login_lines(Some(&login.id), login.view)
        .iter()
        .flat_map(|l| line_bytes(l))
        .collect();
    if !put(&mut stream, &login_bytes).await {
        emit(error("送信に失敗しました".into()));
        return None;
    }
    Some(Conn::new(stream, login.host.clone(), login.view))
}

/// 受けた行を処理し終えた理由
enum Lines {
    /// 全部処理した
    Done,
    /// サーバの #x・#close
    Closed,
    /// `#ch-srv` を受けた。残りの行は `queue` に残る
    Transfer(String),
}

/// 世界移動を試した結果
enum Transfer {
    /// 移動元のまま続ける。移動の間に移動元から受けた行を続けて処理する(#71)
    Stay(Vec<Vec<u8>>),
    /// 移動した。移動元で受けていた残りの行は捨てる(Philly も ChSrv の成功で受信の処理を打ち切る)
    Moved,
    /// 移動の間に送信キューが閉じた(タブを閉じた)
    Closed,
}

/// 接続し、切れるまで送受信を続ける。`outgoing` が閉じたら `#x` を送って切る。
pub async fn run(login: Login, mut outgoing: mpsc::Receiver<String>, mut emit: impl FnMut(UiEvent)) {
    // 失敗した時も closed() を送る。送らないとタブが接続中のまま残り、「接続」で繋ぎ直せない (#131)
    let Some(mut conn) = connect(&login, &mut emit).await else {
        return emit(closed());
    };
    let mut view = login.view;
    let opts = LogOptions::default();
    let mut record = recorder(&login);
    let mut buf = vec![0u8; 32 * 1024];
    let mut last_recv = Instant::now();
    let mut keepalive_sent = false;
    let mut warned = false;
    // `#code-sjis` に返事をするサーバか。返事を見たら、無応答を切断とみなせる
    let mut answers = false;
    let mut auto = AutoUnequip::default();
    let mut hits = HitGate::default();
    let mut stats = NetStats::default();

    'conn: loop {
        let wake = next_wake(last_recv, keepalive_sent, warned, answers);
        let mut reply: Vec<String> = Vec::new();
        tokio::select! {
            r = conn.stream.read(&mut buf) => {
                quickack(&conn.stream);
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
                stats.raw += n;
                let data = match conn.inflate.feed(&buf[..n]) {
                    Ok(d) => d,
                    Err(e) => {
                        emit(error(format!("受信した行を展開出来ません: {e}")));
                        break;
                    }
                };
                if let Some(f) = record.as_mut() {
                    use std::io::Write;
                    let _ = f.write_all(&data);
                }
                stats.data += data.len();
                let mut queue: VecDeque<Vec<u8>> = conn.lines.feed(&data).into();
                if crate::trace::on() {
                    let now = Instant::now();
                    for _ in queue.iter().filter(|l| l.starts_with(b"#v6 G ")) {
                        stats.moved(now);
                    }
                }
                answers |= queue.iter().any(|l| l.starts_with(b"#code-sjis-ok"));
                loop {
                    let handled = handle_lines(&mut conn.parser, &mut queue, &mut auto, &mut reply, &opts, &mut emit);
                    let server = match handled {
                        Lines::Done => break,
                        Lines::Closed => break 'conn,
                        Lines::Transfer(server) => server,
                    };
                    let moved =
                        handle_transfer(&mut conn, &server, &login.id, &mut view, &mut outgoing, &mut reply, &mut emit)
                            .await;
                    last_recv = Instant::now();
                    match moved {
                        Transfer::Stay(skipped) => queue.extend(skipped),
                        Transfer::Moved => break,
                        Transfer::Closed => return emit(quit(&mut conn.stream).await),
                    }
                }
            }
            text = outgoing.recv() => match text {
                Some(text) => {
                    if text == "#ulist" {
                        conn.parser.clear_users();
                    }
                    if text.starts_with(INTERNAL_PREFIX) {
                        // 確かめの期限が切れた後に届いた TRANSFER_YES などは、サーバへ送らない
                        keep_view(&text, &mut view);
                    } else if hits.hold(&text, conn.parser.attacking(), Instant::now()) {
                        // 攻撃の待ちの間の hit は送らず、待ちが明けた時に 1 回だけ送る (#177)
                    } else {
                        match auto.start(&text, std::time::Instant::now()) {
                            Some(unequip) => reply.push(unequip.into()),
                            None => reply.push(text),
                        }
                    }
                }
                None => return emit(quit(&mut conn.stream).await),
            },
            // 警告を出した後は、次に受信するまで待たない(過去の時刻を待つと、待たずに回り続ける。#61)
            _ = tokio::time::sleep_until(wake.unwrap_or(last_recv)), if wake.is_some() => {
                if !keepalive_sent {
                    reply.push("#code-sjis".into());
                    keepalive_sent = true;
                } else if answers {
                    emit(error("サーバから応答が無いので切断しました".into()));
                    break;
                } else if !warned {
                    warned = true;
                    emit(error("サーバから3分間応答がありません".into()));
                }
            }
        }
        if hits.release(conn.parser.attacking(), Instant::now()) {
            reply.push("hit".into());
        }
        let want_view = view.map(|v| view_line(v, conn.parser.map_style() == Some("turn")));
        // v6 の地図が届いたら、地図の間隔を 1 (0.1 秒) にする。v6 の地図は変わった時しか送られないので、
        // 止まっている間は増えない。2 (0.2 秒) では、10 歩/秒で歩く他のキャラが 2 マスずつ跳んで見えた (#194)
        if !conn.fast_map && conn.parser.has_v6_map() {
            reply.push("#map-iv 1".into());
            conn.fast_map = true;
        }
        if want_view != conn.sent_view {
            reply.extend(want_view.clone());
            conn.sent_view = want_view;
        }
        if debug_on() {
            reply.iter().for_each(|l| emit(debug_line("→", l)));
        }
        let bytes: Vec<u8> = reply.iter().flat_map(|l| line_bytes(l)).collect();
        if crate::trace::on() {
            let now = Instant::now();
            reply.iter().filter(|l| l.starts_with("go")).for_each(|_| stats.sent_go(now));
            stats.sent += bytes.len();
            stats.flush(now);
        }
        if !bytes.is_empty() {
            let sent = match timeout(WRITE_TIMEOUT, conn.stream.write_all(&bytes)).await {
                Ok(r) => r.map_err(|e| e.to_string()),
                Err(_) => Err("30秒待っても送れません".into()),
            };
            if let Err(e) = sent {
                emit(error(format!("送信に失敗しました: {e}")));
                break;
            }
        }
    }
    emit(closed());
}

/// `queue` の行を前から解析して UI へ送る。自動応答は `reply` に足す。
/// `#ch-srv` を受けたらそこで止め、後ろの行は `queue` に残す(移動に失敗したら続けて処理する。#71)
fn handle_lines(
    parser: &mut Parser,
    queue: &mut VecDeque<Vec<u8>>,
    auto: &mut AutoUnequip,
    reply: &mut Vec<String>,
    opts: &LogOptions,
    emit: &mut impl FnMut(UiEvent),
) -> Lines {
    while let Some(line) = queue.pop_front() {
        if crate::trace::on() {
            crate::trace::write(&format!("recv {}", crate::trace::head(&String::from_utf8_lossy(&line))));
        }
        if debug_on() && line.starts_with(b"#") {
            emit(debug_line("←", &codec::decode(&line)));
        }
        // 系統魔法の前に外した装備のリストなどは出さない(#4。Philly も #more の外だけで見る)
        let now = std::time::Instant::now();
        if !parser.in_more() && auto.active(now) && auto.filter(&strip_tags(&codec::decode(&line)), now, reply) {
            continue;
        }
        for ev in parser.feed(&line) {
            match ev {
                Event::Internal {
                    action: InternalAction::Lag,
                } => reply.push("#end-lag".into()),
                Event::Internal {
                    action: InternalAction::Remap,
                } => reply.push("#map".into()),
                Event::Message(m) => emit(log_event(m, opts, parser.in_more())),
                // サーバの #x・#close。ここでは UI へ送らず、受信を終える。終わりに必ず closed() を送るので、
                // ここでも送ると UI へ 2 回届く。サーバが接続を閉じなくても、こちらから切る
                Event::Connection { .. } => return Lines::Closed,
                Event::WorldTransfer { ref server, .. } => {
                    let server = server.clone();
                    emit(UiEvent::Proto(ev));
                    return Lines::Transfer(server);
                }
                ev => emit(UiEvent::Proto(ev)),
            }
        }
    }
    Lines::Done
}

/// `#ch-srv` を受けた時の世界移動。それまでの自動応答を送ってから、要るなら UI に確かめ、移動を試す。
/// 移動に成功したら `conn` を移動先の物に作り直す
async fn handle_transfer(
    conn: &mut Conn,
    server: &str,
    id: &str,
    view: &mut Option<(u8, u8)>,
    outgoing: &mut mpsc::Receiver<String>,
    reply: &mut Vec<String>,
    emit: &mut impl FnMut(UiEvent),
) -> Transfer {
    if !reply.is_empty() {
        let bytes: Vec<u8> = reply.drain(..).flat_map(|l| line_bytes(&l)).collect();
        let _ = put(&mut conn.stream, &bytes).await;
    }
    // 移動の間に UI が送った行は、視界の大きさの他は捨てる(Philly の RejectMainThreadSend)。
    // 送信キューが閉じたら(タブを閉じた)移動をやめる。待たないと、閉じたタブのキャラが移動先へログインする(#71)
    // 今と違うホストへ移る時は、キャラ ID を送る前に確かめる(#51)。
    // 悪意のあるサーバか乗っ取られたサーバが、任意のホストへ #reserve <ID> を送らせられる為
    if let Some((h, p)) = transfer_target(server).filter(|(h, _)| !h.eq_ignore_ascii_case(&conn.host)) {
        emit(UiEvent::Ui(UiOnly::ConfirmTransfer {
            host: h.into(),
            port: p,
        }));
        let answer = async {
            loop {
                match outgoing.recv().await {
                    Some(l) if l == TRANSFER_YES => break Some(true),
                    Some(l) if l == TRANSFER_NO => break Some(false),
                    Some(l) => keep_view(&l, view),
                    None => break None,
                }
            }
        };
        let answer = match timeout(TRANSFER_TIMEOUT, answer).await {
            Ok(a) => a,
            Err(_) => {
                emit(UiEvent::Ui(UiOnly::TransferExpired));
                Some(false)
            }
        };
        match answer {
            None => return Transfer::Closed,
            Some(false) => {
                emit(system(false, "世界移動をやめました"));
                let _ = put(&mut conn.stream, &line_bytes("#no-srv")).await;
                return Transfer::Stay(Vec::new());
            }
            Some(true) => {}
        }
    }
    let mut skipped = Vec::new();
    // 移動先へ送る視界。移動の間に変わったら、移動の後に送り直す
    let moving_view = *view;
    let moved = tokio::select! {
        r = transfer(conn, &mut skipped, server, id, moving_view, emit) => r,
        _ = async { while let Some(l) = outgoing.recv().await { keep_view(&l, view) } } => return Transfer::Closed,
    };
    let Some((dst, host)) = moved else {
        return Transfer::Stay(skipped);
    };
    *conn = Conn::new(dst, host, moving_view);
    while let Ok(l) = outgoing.try_recv() {
        keep_view(&l, view);
    }
    Transfer::Moved
}

/// `#x` を送って切り、切れた事を返す。UI が切った時も知らせる(知らせないとタブが接続中のまま残る)
async fn quit(stream: &mut TcpStream) -> UiEvent {
    let _ = put(stream, &line_bytes("#x")).await;
    closed()
}

fn closed() -> UiEvent {
    UiEvent::Proto(Event::Connection {
        state: phi_proto::parser::ConnectionState::Closed,
    })
}

/// 開発用。環境変数 `WPHI_RECORD` にフォルダを指定すると、受信した生のバイト列を
/// `<フォルダ>/<接続先>_<ポート>_<UNIX 時刻>.bin` に書く。phi-proto の正解データを作る元にする。
/// 他のプレイヤーの発言も入るので、正解データに使う時は名前と本文を置き換えてからコミットする。
fn recorder(login: &Login) -> Option<std::fs::File> {
    let dir = std::env::var_os("WPHI_RECORD")?;
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    let path = std::path::Path::new(&dir).join(format!("{}_{}_{secs}.bin", login.host, login.port));
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::File::create(path).ok()
}

/// 世界移動(Philly の PersonalThread.cpp classTransportCharacter::ChSrv)。成功したら移動先の接続とホストを返す。
///
/// 移動先へ `#reserve <ID>` → `#rsv-ok` を待つ → 移動元へ `#trans <IP> <ポート>` → `#trs-ok` を待つ →
/// 移動先へ `#ch-srv-ok` → 移動先へログイン時の設定(`#open` なし)。
/// 失敗したら移動元へ `#no-srv`(移動先に繋がらない時)か `#ch-srv-no`(移動元が断った時)を送り、移動元のまま続ける。
async fn transfer(
    src: &mut Conn,
    src_skipped: &mut Vec<Vec<u8>>,
    server: &str,
    id: &str,
    view: Option<(u8, u8)>,
    emit: &mut impl FnMut(UiEvent),
) -> Option<(TcpStream, String)> {
    let deadline = || Instant::now() + TRANSFER_TIMEOUT;
    let target = transfer_target(server);

    emit(system(true, "転送先世界へゲート接続開始..."));
    let connected = match target {
        Some((host, port)) => timeout(CONNECT_TIMEOUT, TcpStream::connect((host, port)))
            .await
            .ok()
            .and_then(|r| r.ok())
            .inspect(tune)
            .map(|s| (s, host, port)),
        None => None,
    };
    let (mut dst, host, port) = match connected {
        Some(c) => c,
        None => {
            emit(system(false, "転送先の世界が見つかりません"));
            let _ = put(&mut src.stream, &line_bytes("#no-srv")).await;
            return None;
        }
    };

    emit(system(true, "転送先世界に転送準備要求..."));
    let mut dst_lines = LineBuffer::new();
    let reserved = put(&mut dst, &line_bytes(&format!("#reserve {id}"))).await
        && wait_line(
            &mut dst,
            &mut dst_lines,
            &mut Inflate::new(),
            b"#rsv-ok",
            &[b"#rsv-no", b"#x"],
            deadline(),
            &mut Vec::new(),
        )
        .await;
    if !reserved {
        let _ = put(&mut src.stream, &line_bytes("#no-srv")).await;
        emit(system(
            false,
            "転送準備失敗。転送先の世界で同時接続数をオーバーしている可能性があります。",
        ));
        return None;
    }

    emit(system(true, "転送元世界に転送要求..."));
    let trans = format!("#trans {host} {port}");
    let accepted = put(&mut src.stream, &line_bytes(&trans)).await
        && wait_line(
            &mut src.stream,
            &mut src.lines,
            &mut src.inflate,
            b"#trs-ok",
            &[b"#trs-no"],
            deadline(),
            src_skipped,
        )
        .await;
    if !accepted {
        let _ = put(&mut src.stream, &line_bytes("#ch-srv-no")).await;
        emit(system(false, "転送失敗"));
        // 移動先は断った理由(持ち込めないアイテムなど)を、#reserve を送ったこちらの接続へ書く。
        // 移動元の行より前に起きた事なので先に処理する。移動先のコマンドは移動元の物として扱わない為、# の行は捨てる
        let reason = read_for(&mut dst, &mut dst_lines, REASON_WAIT).await;
        src_skipped.splice(0..0, reason.into_iter().filter(|l| !l.starts_with(b"#")));
        return None;
    }
    let after: Vec<u8> = ["#ch-srv-ok".to_string()]
        .into_iter()
        .chain(login_lines(None, view))
        .flat_map(|l| line_bytes(&l))
        .collect();
    if !put(&mut dst, &after).await {
        emit(system(false, "転送先世界への送信に失敗しました"));
        return None;
    }
    emit(system(true, "転送完了"));
    emit(UiEvent::Ui(UiOnly::WorldMoved {
        host: host.to_string(),
        port,
    }));
    Some((dst, host.to_string()))
}

/// `#ch-srv` の移動先(`ホスト:ポート`)。ポートが u16 に収まらない時も、繋がらない時と同じく移動元へ #no-srv を返す(#71)
fn transfer_target(server: &str) -> Option<(&str, u16)> {
    server
        .rsplit_once(':')
        .and_then(|(h, p)| Some((h, p.parse::<u16>().ok()?)))
}

/// 移動先が断った理由を待つ時間。理由は移動元の #trs-no より前に書かれるので、届いていれば待たずに読める
const REASON_WAIT: Duration = Duration::from_secs(1);

/// `wait` の間か切れるまで、届いた行を読む
async fn read_for(stream: &mut TcpStream, lines: &mut LineBuffer, wait: Duration) -> Vec<Vec<u8>> {
    let deadline = Instant::now() + wait;
    let mut inflate = Inflate::new();
    let mut buf = [0u8; 4096];
    let mut got = Vec::new();
    while let Ok(Ok(n)) = timeout_at(deadline, stream.read(&mut buf)).await {
        if n == 0 {
            break;
        }
        let Ok(data) = inflate.feed(&buf[..n]) else { break };
        got.extend(lines.feed(&data));
    }
    got
}

/// `ok` の行が来たら true、`ng` の行が来るか、切れるか、`deadline` を過ぎたら false。
/// 他の行は `skipped` に貯める(移動に失敗した時に、移動元から受けた行として処理し直す)。
async fn wait_line(
    stream: &mut TcpStream,
    lines: &mut LineBuffer,
    inflate: &mut Inflate,
    ok: &[u8],
    ng: &[&[u8]],
    deadline: Instant,
    skipped: &mut Vec<Vec<u8>>,
) -> bool {
    let mut buf = [0u8; 4096];
    loop {
        let n = match timeout_at(deadline, stream.read(&mut buf)).await {
            Ok(Ok(n)) if n > 0 => n,
            _ => return false,
        };
        let Ok(data) = inflate.feed(&buf[..n]) else {
            return false;
        };
        let mut got = lines.feed(&data).into_iter();
        while let Some(line) = got.next() {
            if line == ok {
                return true;
            }
            if ng.contains(&line.as_slice()) {
                skipped.extend(got);
                return false;
            }
            skipped.push(line);
        }
    }
}

static DEBUG: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// デバッグ表示(ツールのメニュー)。オンの間は、受けた # の行と送った行をログに灰色で出す
pub fn debug_on() -> bool {
    DEBUG.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn set_debug(on: bool) {
    DEBUG.store(on, std::sync::atomic::Ordering::Relaxed);
}

fn debug_line(dir: &str, text: &str) -> UiEvent {
    let text = phi_proto::tag_to_html::escape_html(text);
    UiEvent::Ui(UiOnly::Log {
        channel: Channel::System,
        html: format!(r#"<font color="gray">{dir} {text}</font>"#),
        from: None,
        text: String::new(),
        raw: String::new(),
        speech: None,
        no_flash: true,
    })
}

/// クライアントが出すログの行(Philly の AddSysMessageOk / AddSysMessageNg)。
fn system(ok: bool, text: &str) -> UiEvent {
    let class = if ok { "class_system_ok" } else { "class_system_ng" };
    let text = phi_proto::tag_to_html::escape_html(text);
    UiEvent::Ui(UiOnly::Log {
        channel: Channel::System,
        html: format!(r#"<font class="{class}">{text}</font>"#),
        from: None,
        text: String::new(),
        raw: String::new(),
        speech: None,
        no_flash: false,
    })
}

/// in_more の行(看板の本文など)は効果音と照合しない(Philly は #more の外だけで照合する)。
/// 看板に効果音の語を並べると、読んだ人の手元で音が鳴り続ける為。
fn log_event(m: Message, opts: &LogOptions, in_more: bool) -> UiEvent {
    UiEvent::Ui(UiOnly::Log {
        channel: m.channel,
        html: to_html(&m.text, opts),
        from: m.from,
        raw: m.text.clone(),
        speech: m.speech,
        text: if in_more { String::new() } else { m.text },
        no_flash: false,
    })
}

fn error(message: String) -> UiEvent {
    UiEvent::Ui(UiOnly::Error { message })
}

/// WRITE_TIMEOUT までに書けたら真。世界移動の確かめや移動の間も、読まない相手で止まり続けない為 (#127)
async fn put<W: tokio::io::AsyncWrite + Unpin>(w: &mut W, b: &[u8]) -> bool {
    matches!(timeout(WRITE_TIMEOUT, w.write_all(b)).await, Ok(Ok(())))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 攻撃の待ちの間の hit は 1 回だけ覚え、待ちが明けたら送る (#177)
    #[test]
    fn hit_waits_for_end_of_attack() {
        let t = Instant::now();
        let mut g = HitGate::default();
        assert!(!g.hold("hit", false, t), "待ちでなければそのまま送る");
        assert!(!g.hold("say", true, t), "hit 以外はそのまま送る");
        assert!(g.hold("hit", true, t) && g.hold("hit", true, t), "連打しても覚えるのは 1 回");
        assert!(!g.release(true, t), "待ちの間は送らない");
        assert!(g.release(false, t), "明けたら送る");
        assert!(!g.release(false, t), "送るのは 1 回だけ");
        // #end-at が来ないまま待ち過ぎたら送る
        g.hold("hit", true, t);
        assert!(g.release(true, t + HIT_HOLD_MAX));
    }
    use serde_json::{Value, json};

    /// #more の中の行(看板の本文)は効果音と照合しない(#19)。
    #[test]
    fn more_lines_skip_sound_matching() {
        let text = |in_more| {
            let m = Message {
                channel: Channel::Log,
                text: "ボーン".into(),
                from: None,
                markup: false,
            };
            match log_event(m, &LogOptions::default(), in_more) {
                UiEvent::Ui(UiOnly::Log { text, .. }) => text,
                _ => unreachable!(),
            }
        };
        assert_eq!(text(false), "ボーン");
        assert_eq!(text(true), "");
    }

    /// 圧縮の返事の行が2回の受信に跨っても、その後ろから展開する
    #[test]
    fn inflate_after_compress_reply() {
        use flate2::{Compress, Compression, FlushCompress};
        let mut z = Compress::new(Compression::default(), true);
        let mut packed = Vec::with_capacity(256);
        z.compress_vec(b"#v6 G 0 -1\n", &mut packed, FlushCompress::Sync)
            .unwrap();
        let mut wire = b"#ex-map style=solid\n#ex-switch compr".to_vec();
        let cut = wire.len();
        wire.extend_from_slice(b"ess=deflate\n");
        wire.extend_from_slice(&packed);
        let mut inf = Inflate::new();
        let mut got = inf.feed(&wire[..cut]).unwrap();
        got.extend(inf.feed(&wire[cut..cut + 20]).unwrap());
        got.extend(inf.feed(&wire[cut + 20..]).unwrap());
        assert_eq!(got, b"#ex-map style=solid\n#ex-switch compress=deflate\n#v6 G 0 -1\n");
    }

    /// 圧縮の終わりの後ろにバイトが来ても、回り続けずに切る (#124)
    #[test]
    fn inflate_rejects_bytes_after_stream_end() {
        use flate2::{Compress, Compression, FlushCompress};
        let mut z = Compress::new(Compression::default(), true);
        let mut packed = Vec::with_capacity(256);
        z.compress_vec(b"hello\n", &mut packed, FlushCompress::Finish).unwrap();
        let mut wire = b"#ex-switch compress=deflate\n".to_vec();
        wire.extend_from_slice(&packed);
        wire.extend_from_slice(b"garbage after end");
        assert!(Inflate::new().feed(&wire).is_err());
    }

    use tokio::{
        io::{AsyncBufReadExt, BufReader},
        net::TcpListener,
    };

    #[test]
    fn no_wake_after_warning() {
        let t = Instant::now();
        assert_eq!(next_wake(t, false, false, false), Some(t + KEEPALIVE_AFTER));
        assert_eq!(next_wake(t, true, false, false), Some(t + WARN_AFTER));
        assert_eq!(next_wake(t, true, true, false), None);
        // #code-sjis に返事をするサーバは、返事が無ければ早く切断とみなす (#179)
        assert_eq!(next_wake(t, true, false, true), Some(t + KEEPALIVE_AFTER + DEAD_AFTER));
    }

    /// 偽サーバに繋ぎ、ログインの送信、#lag への応答、送信の cp932 化、ログの HTML 化、切断を確かめる。
    #[tokio::test]
    async fn talks_to_server() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            let mut got = Vec::new();
            for _ in 0..login_lines(Some("ID"), None).len() {
                got.push(read_bytes(&mut r).await);
            }
            // 2バイト文字の途中で分けて送る
            let mut talk = codec::encode("勇者 > /*cl=red*/こんにちは/*.*/\n");
            let rest = talk.split_off(5);
            w.write_all(&talk).await.unwrap();
            w.write_all(&rest).await.unwrap();
            w.write_all(b"#lag\n").await.unwrap();
            // 応答の #end-lag と UI からの送信を受け取る(順序は問わない)
            let mut after = vec![read_bytes(&mut r).await, read_bytes(&mut r).await];
            after.sort();
            w.write_all(b"#x\n").await.unwrap();
            // 接続を閉じずに返す。#x を受けたら、閉じるのを待たずに終える
            (got, after, r, w)
        });

        let (tx, rx) = mpsc::channel(8);
        tx.send("say あ😀".into()).await.unwrap();
        let mut events: Vec<Value> = Vec::new();
        let ended = timeout(
            Duration::from_secs(5),
            run(
                Login {
                    host: "127.0.0.1".into(),
                    port,
                    id: "ID".into(),
                    view: None,
                },
                rx,
                |ev| events.push(serde_json::to_value(ev).unwrap()),
            ),
        )
        .await;
        assert!(ended.is_ok(), "#x の後も受信を続けた");

        let (login, after, _r, _w) = server.await.unwrap();
        assert_eq!(login[0], b"#open ID\n");
        assert_eq!(login.last().unwrap(), b"#ex-switch compress=deflate\n");
        assert_eq!(after, vec![b"#end-lag\n".to_vec(), b"say \x82\xa0?\n".to_vec()]);
        assert_eq!(
            events,
            vec![
                json!({"type": "log", "channel": "log",
                       "html": "<font class=\"class_name\">勇者</font> &gt; <font class=\"cl_red\" style=\"color:red;\">こんにちは</font>",
                       "raw": "勇者 > /*cl=red*/こんにちは/*.*/"}),
                // #x を受けても、切断は 1 回だけ知らせる (#154)
                json!({"type": "connection", "state": "closed"}),
            ]
        );
        drop(tx);
    }

    /// 繋がらなかった時も、エラーの後に切断を知らせる。知らせないとタブが接続中のまま残る (#131)
    #[tokio::test]
    async fn refused_connect_reports_closed() {
        // 開いてすぐ閉じたポートは、繋ぐと断られる
        let port = TcpListener::bind("127.0.0.1:0")
            .await
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let (_tx, rx) = mpsc::channel(8);
        let mut events: Vec<Value> = Vec::new();
        run(
            Login {
                host: "127.0.0.1".into(),
                port,
                id: "ID".into(),
                view: None,
            },
            rx,
            |ev| events.push(serde_json::to_value(ev).unwrap()),
        )
        .await;
        assert_eq!(events.len(), 2, "{events:?}");
        assert_eq!(events[1], json!({"type": "connection", "state": "closed"}));
    }

    /// 1行を改行ごと読む。cp932 のまま比べる時に使う
    async fn read_bytes(r: &mut BufReader<tokio::net::tcp::OwnedReadHalf>) -> Vec<u8> {
        let mut l = Vec::new();
        r.read_until(b'\n', &mut l).await.unwrap();
        l
    }

    async fn read_line(r: &mut BufReader<tokio::net::tcp::OwnedReadHalf>) -> String {
        String::from_utf8(read_bytes(r).await).unwrap()
    }

    const VIEW: Option<(u8, u8)> = Some((11, 7));

    /// 回転は正方形しか受け付けないので、サーバが回転にしたら小さい方に揃えて送り直す。
    /// 窓の大きさが変わったら、今の型に合わせて送り直す
    #[tokio::test]
    async fn view_follows_style_and_window() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel(8);
        let server = tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            let mut got = Vec::new();
            for _ in 0..login_lines(Some("ID"), VIEW).len() {
                got.push(read_line(&mut r).await);
            }
            w.write_all(b"#ex-map style=turn\n").await.unwrap();
            got.push(read_line(&mut r).await);
            tx.send(format!("{VIEW_PREFIX}13 9")).await.unwrap();
            got.push(read_line(&mut r).await);
            w.write_all(b"#ex-map style=solid\n").await.unwrap();
            got.push(read_line(&mut r).await);
            w.write_all(b"#x\n").await.unwrap();
            got
        });
        run(
            Login {
                host: "127.0.0.1".into(),
                port,
                id: "ID".into(),
                view: VIEW,
            },
            rx,
            |_| {},
        )
        .await;
        let got = server.await.unwrap();
        assert!(got.contains(&"#ex-map mapsets=16 view=17 13\n".to_string()));
        assert_eq!(
            got[got.len() - 3..],
            [
                "#ex-map mapsets=16 view=13 13\n",
                "#ex-map mapsets=16 view=15 15\n",
                "#ex-map mapsets=16 view=19 15\n"
            ]
        );
    }

    /// 移動元と移動先の偽サーバで、世界移動の手順を確かめる。
    /// `rsv` は移動先が #reserve に返す行。#rsv-ok なら成功、#rsv-no なら失敗の手順になる。
    async fn world_transfer(rsv: &'static str, trs: &'static str) -> (Vec<String>, Vec<String>, Vec<Value>) {
        let dst_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dst_port = dst_listener.local_addr().unwrap().port();
        let src_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let src_port = src_listener.local_addr().unwrap().port();
        // 移動元が #trans を受けた印
        let (trans_tx, trans_rx) = tokio::sync::oneshot::channel();

        let dst = tokio::spawn(async move {
            let (sock, _) = dst_listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            let mut got = vec![read_line(&mut r).await];
            w.write_all(format!("{}\n", rsv.lines().next().unwrap()).as_bytes())
                .await
                .unwrap();
            if rsv.starts_with("#rsv-ok\n") {
                // 移動元が断る時は、#trans を待ってから理由を書く(移動先のコマンドは捨てる)
                trans_rx.await.unwrap();
                w.write_all(rsv.split_once('\n').unwrap().1.as_bytes()).await.unwrap();
            } else if rsv == "#rsv-ok" {
                // #ch-srv-ok と、#open の無いログイン時の設定
                for _ in 0..login_lines(None, VIEW).len() + 1 {
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
            for _ in 0..login_lines(Some("ID"), VIEW).len() {
                read_line(&mut r).await;
            }
            w.write_all(format!("#ch-srv 127.0.0.1 {dst_port}\n#name after-ch-srv\n").as_bytes())
                .await
                .unwrap();
            let mut got = vec![read_line(&mut r).await];
            if got[0].starts_with("#trans") {
                let _ = trans_tx.send(());
                w.write_all(trs.as_bytes()).await.unwrap();
                if trs.contains("#trs-no") {
                    got.push(read_line(&mut r).await);
                    w.write_all(b"#x\n").await.unwrap();
                }
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
                view: VIEW,
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
        let (src, dst, events) = world_transfer("#rsv-ok", "#trs-ok\n").await;
        assert_eq!(src[0], format!("#trans 127.0.0.1 {}\n", dst_port_of(&events)));
        assert_eq!(dst[0], "#reserve ID\n");
        assert_eq!(dst[1], "#ch-srv-ok\n");
        assert_eq!(dst[2], "#version-cli 05107100\n");
        assert!(!dst.iter().any(|l| l.starts_with("#open")));
        // サーバは世界移動で v6 の大きさを消すので、移動先へも送り直す
        assert!(dst.contains(&"#ex-map mapsets=16 view=17 13\n".to_string()));
        // 移動元の #ch-srv の後の行は捨てる
        assert!(!events.iter().any(|e| e["name"] == "after-ch-srv"));
        assert!(
            events
                .iter()
                .any(|e| e["type"] == "worldMoved" && e["host"] == "127.0.0.1")
        );
    }

    #[tokio::test]
    async fn world_transfer_fails_on_rsv_no() {
        let (src, _dst, events) = world_transfer("#rsv-no", "").await;
        assert_eq!(src[0], "#no-srv\n");
        assert!(!events.iter().any(|e| e["type"] == "worldMoved"));
        // 移動元のまま続くので、#ch-srv の後の行も処理する(#71)
        assert!(events.iter().any(|e| e["name"] == "after-ch-srv"));
    }

    #[tokio::test]
    async fn world_transfer_fails_on_trs_no_keeps_lines() {
        let (src, _dst, events) = world_transfer("#rsv-ok", "#name during-wait\n#trs-no\n#name after-trs-no\n").await;
        assert_eq!(src[1], "#ch-srv-no\n");
        assert!(!events.iter().any(|e| e["type"] == "worldMoved"));
        // 移動の間に受けた行と、#trs-no の後の行も、受けた順に処理する(#71)
        let names: Vec<&str> = events.iter().filter_map(|e| e["name"].as_str()).collect();
        assert_eq!(names, ["after-ch-srv", "during-wait", "after-trs-no"]);
    }

    #[tokio::test]
    async fn world_transfer_shows_reason_from_dst() {
        let (_src, _dst, events) = world_transfer(
            "#rsv-ok\n#name from-dst\nShort sword is not allowed\n",
            "#trs-no\n#name after-trs-no\n",
        )
        .await;
        let raws: Vec<&str> = events
            .iter()
            .filter_map(|e| e["raw"].as_str())
            .filter(|r| !r.is_empty())
            .collect();
        // 移動先の理由は、#trs-no の後の移動元の行より前に出す。移動先のコマンドは処理しない
        assert_eq!(raws, ["Short sword is not allowed"]);
        let names: Vec<&str> = events.iter().filter_map(|e| e["name"].as_str()).collect();
        assert_eq!(names, ["after-ch-srv", "after-trs-no"]);
    }

    /// 移動元の偽サーバ。ログインの行を読み、`ch_srv` を送り、次に受けた行を返す
    async fn src_server(listener: TcpListener, ch_srv: String) -> String {
        let (sock, _) = listener.accept().await.unwrap();
        let (r, mut w) = sock.into_split();
        let mut r = BufReader::new(r);
        for _ in 0..login_lines(Some("ID"), None).len() {
            read_line(&mut r).await;
        }
        w.write_all(ch_srv.as_bytes()).await.unwrap();
        let got = read_line(&mut r).await;
        drop(w);
        got
    }

    fn login() -> impl FnOnce(u16) -> Login {
        |port| Login {
            host: "127.0.0.1".into(),
            port,
            id: "ID".into(),
            view: None,
        }
    }

    #[tokio::test]
    async fn world_transfer_bad_port_sends_no_srv() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let src = tokio::spawn(src_server(listener, "#ch-srv 127.0.0.1 70000\n".into()));
        let (tx, rx) = mpsc::channel(8);
        let run = tokio::spawn(run(login()(port), rx, |_| {}));
        assert_eq!(src.await.unwrap(), "#no-srv\n");
        drop(tx);
        run.await.unwrap();
    }

    /// 今と違うホスト(localhost)へ移る #ch-srv を受け、UI が `answer` を答える。移動元が次に受けた行と、移動先が受けた行
    async fn transfer_to_other_host(answer: &'static str) -> (String, Option<String>) {
        let dst_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dst_port = dst_listener.local_addr().unwrap().port();
        let dst = tokio::spawn(async move {
            let (sock, _) = dst_listener.accept().await.unwrap();
            let mut r = BufReader::new(sock);
            let mut l = String::new();
            r.read_line(&mut l).await.unwrap();
            l
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let src = tokio::spawn(src_server(listener, format!("#ch-srv localhost {dst_port}\n")));
        let (tx, rx) = mpsc::channel(8);
        let (emit, mut events) = event_channel();
        let run = tokio::spawn(run(login()(port), rx, emit));
        wait_event(&mut events, |e| e["type"] == "confirmTransfer").await;
        // 答えを待つ間に送った行はサーバへ送らない
        tx.send("say while-asking".into()).await.unwrap();
        tx.send(answer.into()).await.unwrap();
        let got = timeout(Duration::from_secs(5), src).await.unwrap().unwrap();
        let reserved = if answer == TRANSFER_YES {
            Some(timeout(Duration::from_secs(5), dst).await.unwrap().unwrap())
        } else {
            dst.abort();
            None
        };
        drop(tx);
        let _ = timeout(Duration::from_secs(5), run).await;
        (got, reserved)
    }

    #[tokio::test]
    async fn transfer_to_other_host_asks_first() {
        assert_eq!(transfer_to_other_host(TRANSFER_NO).await, ("#no-srv\n".into(), None));
        // 答えたら移動先へ #reserve を送る(偽の移動先は #rsv-ok を返さずに閉じるので、移動は失敗する)
        let (_, reserved) = transfer_to_other_host(TRANSFER_YES).await;
        assert_eq!(reserved.as_deref(), Some("#reserve ID\n"));
    }

    /// 確かめを待つ間に地図の窓の大きさが変わったら覚えておき、答えた後に送る。
    /// 確かめの外で届いた答え(期限切れの後に答えた時)はサーバへ送らない(#153)
    #[tokio::test]
    async fn internal_lines_never_reach_server() {
        let dst_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dst_port = dst_listener.local_addr().unwrap().port();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let src = tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            for _ in 0..login_lines(Some("ID"), None).len() {
                read_line(&mut r).await;
            }
            w.write_all(format!("#ch-srv localhost {dst_port}\n").as_bytes())
                .await
                .unwrap();
            let mut got = Vec::new();
            for _ in 0..3 {
                got.push(read_line(&mut r).await);
            }
            got
        });
        let (tx, rx) = mpsc::channel(8);
        let (emit, mut events) = event_channel();
        let run = tokio::spawn(run(login()(port), rx, emit));
        wait_event(&mut events, |e| e["type"] == "confirmTransfer").await;
        for l in [&format!("{VIEW_PREFIX}13 9"), TRANSFER_NO, TRANSFER_YES, "say end"] {
            tx.send(l.to_string()).await.unwrap();
        }
        let got = timeout(Duration::from_secs(5), src).await.unwrap().unwrap();
        assert_eq!(got, ["#no-srv\n", "#ex-map mapsets=16 view=19 15\n", "say end\n"]);
        drop(tx);
        let _ = timeout(Duration::from_secs(5), run).await;
        drop(dst_listener);
    }

    /// UI が切った時(送信キューを閉じた時)も #x を送り、切れた事を UI に知らせる(#77)
    #[tokio::test]
    async fn disconnect_sends_x_and_reports_closed() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let src = tokio::spawn(src_server(listener, String::new()));
        let (tx, rx) = mpsc::channel(8);
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let e = events.clone();
        let run = tokio::spawn(run(login()(port), rx, move |ev| {
            e.lock().unwrap().push(serde_json::to_value(ev).unwrap())
        }));
        drop(tx);
        assert_eq!(timeout(Duration::from_secs(5), src).await.unwrap().unwrap(), "#x\n");
        timeout(Duration::from_secs(5), run).await.unwrap().unwrap();
        assert!(
            events
                .lock()
                .unwrap()
                .iter()
                .any(|e| e["type"] == "connection" && e["state"] == "closed")
        );
    }

    #[tokio::test]
    async fn closing_during_transfer_stops_it() {
        // 移動先は #reserve に答えない
        let dst_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dst_port = dst_listener.local_addr().unwrap().port();
        let (reserved_tx, reserved_rx) = tokio::sync::oneshot::channel();
        let dst = tokio::spawn(async move {
            let (sock, _) = dst_listener.accept().await.unwrap();
            let mut r = BufReader::new(sock);
            let mut l = String::new();
            r.read_line(&mut l).await.unwrap();
            let _ = reserved_tx.send(l);
            std::future::pending::<()>().await;
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let src = tokio::spawn(src_server(listener, format!("#ch-srv 127.0.0.1 {dst_port}\n")));
        let (tx, rx) = mpsc::channel(8);
        let run = tokio::spawn(run(login()(port), rx, |_| {}));
        // #rsv-ok を待っている間に閉じる
        assert_eq!(reserved_rx.await.unwrap(), "#reserve ID\n");
        drop(tx);
        timeout(Duration::from_secs(5), run).await.unwrap().unwrap();
        assert_eq!(src.await.unwrap(), "#x\n");
        dst.abort();
    }

    /// UI へのイベントを channel に流す。試験は固定時間を待たずに、イベントが届くのを待つ
    fn event_channel() -> (impl FnMut(UiEvent) + Send + 'static, mpsc::UnboundedReceiver<Value>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (move |ev| drop(tx.send(serde_json::to_value(ev).unwrap())), rx)
    }

    /// `pred` に合うイベントが届くまで待つ。それより前のイベントは読み捨てる
    async fn wait_event(events: &mut mpsc::UnboundedReceiver<Value>, pred: impl Fn(&Value) -> bool) -> Value {
        loop {
            let e = events.recv().await.expect("待つイベントが届く前に接続が終わった");
            if pred(&e) {
                return e;
            }
        }
    }

    /// 無受信が2分続いたら #code-sjis を送り、3分続いたら警告する。時計は止めて進める
    #[tokio::test(start_paused = true)]
    async fn keepalive_then_warning() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (end_tx, end_rx) = tokio::sync::oneshot::channel::<()>();
        let start = Instant::now();
        let server = tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            for _ in 0..login_lines(Some("ID"), None).len() {
                read_line(&mut r).await;
            }
            let keepalive = read_line(&mut r).await;
            let at = start.elapsed();
            end_rx.await.unwrap();
            w.write_all(b"#x\n").await.unwrap();
            (keepalive, at, r, w)
        });
        let (_tx, rx) = mpsc::channel(8);
        let (emit, mut events) = event_channel();
        let run = tokio::spawn(run(login()(port), rx, emit));
        let warn = wait_event(&mut events, |e| e["type"] == "error").await;
        assert_eq!(warn["message"], "サーバから3分間応答がありません");
        assert!(start.elapsed() >= WARN_AFTER);
        end_tx.send(()).unwrap();
        let (keepalive, at, _r, _w) = server.await.unwrap();
        assert_eq!(keepalive, "#code-sjis\n");
        assert!(at >= KEEPALIVE_AFTER && at < WARN_AFTER, "{at:?}");
        run.await.unwrap();
    }

    /// 世界移動の確かめに TRANSFER_TIMEOUT まで答えが無ければ、確かめの窓を閉じさせて #no-srv を返す(#153)
    #[tokio::test(start_paused = true)]
    async fn transfer_confirm_expires() {
        let dst_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dst_port = dst_listener.local_addr().unwrap().port();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let start = Instant::now();
        let src = tokio::spawn(src_server(listener, format!("#ch-srv localhost {dst_port}\n")));
        let (_tx, rx) = mpsc::channel(8);
        let (emit, mut events) = event_channel();
        let run = tokio::spawn(run(login()(port), rx, emit));
        wait_event(&mut events, |e| e["type"] == "confirmTransfer").await;
        wait_event(&mut events, |e| e["type"] == "transferExpired").await;
        assert!(start.elapsed() >= TRANSFER_TIMEOUT);
        assert_eq!(src.await.unwrap(), "#no-srv\n");
        run.await.unwrap();
    }

    /// `#ex-switch compress=deflate` の返事の後ろを展開して処理する
    #[tokio::test]
    async fn compressed_session() {
        use flate2::{Compress, Compression, FlushCompress};
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            for _ in 0..login_lines(Some("ID"), None).len() {
                read_line(&mut r).await;
            }
            let mut z = Compress::new(Compression::default(), true);
            let mut packed = Vec::with_capacity(1024);
            let mut plain = codec::encode("勇者 > やあ\n");
            plain.extend_from_slice(b"#x\n");
            z.compress_vec(&plain, &mut packed, FlushCompress::Sync).unwrap();
            let mut wire = b"#ex-switch compress=deflate\n".to_vec();
            wire.extend_from_slice(&packed);
            w.write_all(&wire).await.unwrap();
            (r, w)
        });
        let (_tx, rx) = mpsc::channel(8);
        let mut events: Vec<Value> = Vec::new();
        timeout(
            Duration::from_secs(5),
            run(login()(port), rx, |ev| events.push(serde_json::to_value(ev).unwrap())),
        )
        .await
        .unwrap();
        let _conn = server.await.unwrap();
        let raws: Vec<&str> = events.iter().filter_map(|e| e["raw"].as_str()).collect();
        assert_eq!(raws, ["勇者 > やあ"]);
        assert_eq!(
            events.last().unwrap(),
            &json!({"type": "connection", "state": "closed"})
        );
    }

    /// 世界移動の後は移動先を今の接続先として覚える。同じホストへの次の移動は確かめない
    #[tokio::test]
    async fn world_move_updates_host() {
        // 2度目の移動先。開いてすぐ閉じたので繋がらない
        let closed_port = TcpListener::bind("127.0.0.1:0")
            .await
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let dst_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dst_port = dst_listener.local_addr().unwrap().port();
        let dst = tokio::spawn(async move {
            let (sock, _) = dst_listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            assert_eq!(read_line(&mut r).await, "#reserve ID\n");
            w.write_all(b"#rsv-ok\n").await.unwrap();
            // #ch-srv-ok と、#open の無いログイン時の設定
            for _ in 0..login_lines(None, None).len() + 1 {
                read_line(&mut r).await;
            }
            w.write_all(format!("#ch-srv localhost {closed_port}\n").as_bytes())
                .await
                .unwrap();
            let got = timeout(Duration::from_secs(5), read_line(&mut r))
                .await
                .expect("2度目の移動で確かめを待った");
            drop(w);
            got
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let src = tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            for _ in 0..login_lines(Some("ID"), None).len() {
                read_line(&mut r).await;
            }
            w.write_all(format!("#ch-srv localhost {dst_port}\n").as_bytes())
                .await
                .unwrap();
            let trans = read_line(&mut r).await;
            w.write_all(b"#trs-ok\n").await.unwrap();
            (trans, r, w)
        });
        let (tx, rx) = mpsc::channel(8);
        let (emit, mut events) = event_channel();
        let run = tokio::spawn(run(login()(port), rx, emit));
        wait_event(&mut events, |e| e["type"] == "confirmTransfer").await;
        tx.send(TRANSFER_YES.into()).await.unwrap();
        let moved = wait_event(&mut events, |e| e["type"] == "worldMoved").await;
        assert_eq!(moved["host"], "localhost");
        assert_eq!(dst.await.unwrap(), "#no-srv\n");
        let (trans, _r, _w) = src.await.unwrap();
        assert!(trans.starts_with("#trans "), "{trans}");
        timeout(Duration::from_secs(5), run).await.unwrap().unwrap();
        while let Ok(e) = events.try_recv() {
            assert_ne!(e["type"], "confirmTransfer");
        }
    }

    /// #trs-ok の後に移動先へ送れなければ、移動をやめて移動元のまま続ける
    #[tokio::test]
    async fn transfer_fails_when_dst_resets() {
        let (trans_tx, trans_rx) = tokio::sync::oneshot::channel::<()>();
        let (reset_tx, reset_rx) = tokio::sync::oneshot::channel::<()>();
        let (end_tx, end_rx) = tokio::sync::oneshot::channel::<()>();
        let dst_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dst_port = dst_listener.local_addr().unwrap().port();
        let dst = tokio::spawn(async move {
            let (mut sock, _) = dst_listener.accept().await.unwrap();
            let mut l = Vec::new();
            BufReader::new(&mut sock).read_until(b'\n', &mut l).await.unwrap();
            sock.write_all(b"#rsv-ok\n").await.unwrap();
            // 移動元が #trans を受けたら RST で切る。こちらからの #ch-srv-ok の送信が失敗する
            trans_rx.await.unwrap();
            sock.set_zero_linger().unwrap();
            drop(sock);
            reset_tx.send(()).unwrap();
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let src = tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            for _ in 0..login_lines(Some("ID"), None).len() {
                read_line(&mut r).await;
            }
            w.write_all(format!("#ch-srv 127.0.0.1 {dst_port}\n").as_bytes())
                .await
                .unwrap();
            let trans = read_line(&mut r).await;
            trans_tx.send(()).unwrap();
            reset_rx.await.unwrap();
            w.write_all(b"#trs-ok\n").await.unwrap();
            end_rx.await.unwrap();
            w.write_all(b"#x\n").await.unwrap();
            (trans, r, w)
        });
        let (_tx, rx) = mpsc::channel(8);
        let (emit, mut events) = event_channel();
        let run = tokio::spawn(run(login()(port), rx, emit));
        wait_event(&mut events, |e| {
            e["html"]
                .as_str()
                .is_some_and(|h| h.contains("転送先世界への送信に失敗しました"))
        })
        .await;
        end_tx.send(()).unwrap();
        timeout(Duration::from_secs(5), run).await.unwrap().unwrap();
        dst.await.unwrap();
        let (trans, _r, _w) = src.await.unwrap();
        assert!(trans.starts_with("#trans "), "{trans}");
        while let Ok(e) = events.try_recv() {
            assert_ne!(e["type"], "worldMoved");
        }
    }

    fn dst_port_of(events: &[Value]) -> u64 {
        events.iter().find(|e| e["type"] == "worldMoved").unwrap()["port"]
            .as_u64()
            .unwrap()
    }
}
