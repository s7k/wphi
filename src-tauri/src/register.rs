//! 新規キャラ作成(`#ex-register`)。phi-client-web の `backend/app/register.py` から移植した。
//!
//! 1. `#ex-register start`
//! 2. `name="<名前>" pass=<6字> image=<番号> mail=<メール>` を `#` 無しの行で送る
//! 3. `#ex-register end`
//!    - 成功: サーバがキャラを作って `#set-user-id <ID>` を返す。その接続はログイン済みになるので `#x` で抜ける
//!    - 失敗: `#ex-register reject [name] [pass] [image] [mail]`(足りない項目)
//!
//! 初期グラの一覧は `#ex-get REGINFO IMG` → `#ex-put REGINFO IMG` 〜 `#ex-put .` で取る。

use std::time::Duration;

use phi_proto::{LineBuffer, codec};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::{Instant, timeout, timeout_at},
};

/// サーバ側の待ち時間は 600 秒だが、こちらは短く待つ(register.py の REGISTER_TIMEOUT_SEC)。
const TIMEOUT: Duration = Duration::from_secs(30);
const PASS_LEN: usize = 6;

fn has_control(s: &str) -> bool {
    s.chars().any(|c| (c as u32) < 0x20 || c as u32 == 0x7f)
}

/// 送る前の確かめ。足りない項目を返す(空なら送れる)。
///
/// 1行に繋げて送るので、改行や制御文字を入れられると行を割ってコマンドを差し込める(register.py の CR-13)。
/// 名前は "" で囲むので " を、pass と mail は空白で区切るので空白も入れさせない。
pub fn validate(name: &str, pass: &str, mail: &str) -> Vec<&'static str> {
    let mut bad = Vec::new();
    if name.chars().count() < 2 || has_control(name) || name.contains('"') {
        bad.push("name");
    }
    if pass.chars().count() != PASS_LEN || has_control(pass) || pass.contains(char::is_whitespace) {
        bad.push("pass");
    }
    if has_control(mail) || mail.contains(char::is_whitespace) {
        bad.push("mail");
    }
    bad
}

async fn connect(host: &str, port: u16) -> Result<TcpStream, String> {
    match timeout(TIMEOUT, TcpStream::connect((host, port))).await {
        Ok(Ok(s)) => Ok(s),
        Ok(Err(e)) => Err(format!("接続出来ません: {e}")),
        Err(_) => Err("接続がタイムアウトしました".into()),
    }
}

async fn send(s: &mut TcpStream, line: &str) -> Result<(), String> {
    let mut b = codec::encode(line);
    b.push(b'\n');
    s.write_all(&b).await.map_err(|e| format!("送信に失敗しました: {e}"))
}

/// 行を1つずつ読み、`f` が Some を返したらそれを返す。
async fn read_until<T>(
    s: &mut TcpStream,
    deadline: Instant,
    mut f: impl FnMut(&str) -> Option<T>,
) -> Result<T, String> {
    let mut lines = LineBuffer::new();
    let mut buf = [0u8; 4096];
    loop {
        let n = match timeout_at(deadline, s.read(&mut buf)).await {
            Ok(Ok(0)) => return Err("サーバから切断されました".into()),
            Ok(Ok(n)) => n,
            Ok(Err(e)) => return Err(format!("受信に失敗しました: {e}")),
            Err(_) => return Err("サーバの返事がタイムアウトしました".into()),
        };
        for line in lines.feed(&buf[..n]) {
            if let Some(v) = f(codec::decode(&line).trim()) {
                return Ok(v);
            }
        }
    }
}

/// 選べる初期グラの名前。
pub async fn graphics(host: &str, port: u16) -> Result<Vec<String>, String> {
    let mut s = connect(host, port).await?;
    send(&mut s, "#ex-get REGINFO IMG").await?;
    let mut started = false;
    let mut names = Vec::new();
    read_until(&mut s, Instant::now() + TIMEOUT, |line| {
        if !started {
            started = line == "#ex-put REGINFO IMG";
            return None;
        }
        if line == "#ex-put ." {
            return Some(std::mem::take(&mut names));
        }
        names.push(line.to_string());
        None
    })
    .await
}

pub enum Outcome {
    /// 作ったキャラの ID
    Created(String),
    /// サーバが断った項目
    Rejected(Vec<String>),
}

pub async fn register(
    host: &str,
    port: u16,
    name: &str,
    pass: &str,
    image: u32,
    mail: &str,
) -> Result<Outcome, String> {
    let bad = validate(name, pass, mail);
    if !bad.is_empty() {
        return Ok(Outcome::Rejected(bad.into_iter().map(String::from).collect()));
    }
    let mut s = connect(host, port).await?;
    send(&mut s, "#ex-register start").await?;
    // #ex-register を前置すると v5y の phi_dm.c は start/end/cancel 以外として捨てる
    send(
        &mut s,
        &format!(r#"name="{name}" pass={pass} image={image} mail={mail}"#),
    )
    .await?;
    send(&mut s, "#ex-register end").await?;
    let result = read_until(&mut s, Instant::now() + TIMEOUT, |line| {
        if let Some(rest) = line.strip_prefix("#ex-register reject") {
            let fields = rest
                .split_whitespace()
                .filter(|f| ["name", "pass", "image", "mail"].contains(f))
                .map(String::from)
                .collect();
            return Some(Outcome::Rejected(fields));
        }
        line.strip_prefix("#set-user-id")
            .map(|uid| Outcome::Created(uid.trim().to_string()))
            .filter(|o| !matches!(o, Outcome::Created(uid) if uid.is_empty()))
    })
    .await;
    match &result {
        // 登録した接続はログイン済みになっているので抜ける
        Ok(Outcome::Created(_)) => {
            let _ = send(&mut s, "#x").await;
        }
        // 返事が無い時は中止を試みる
        Err(_) => {
            let _ = send(&mut s, "#ex-register cancel").await;
        }
        Ok(Outcome::Rejected(_)) => {}
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncBufReadExt, BufReader},
        net::TcpListener,
    };

    #[test]
    fn rejects_line_injection() {
        assert!(validate("勇者", "abc123", "").is_empty());
        assert_eq!(validate("勇者\n#x", "abc123", ""), ["name"]);
        assert_eq!(validate("a\"b", "abc 12", "x y"), ["name", "pass", "mail"]);
        assert_eq!(validate("あ", "abc12", ""), ["name", "pass"]);
    }

    /// 偽サーバに `reply` を返させ、送った行と結果を返す。
    async fn run(reply: &'static str) -> (Vec<String>, Result<Outcome, String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            let mut got = Vec::new();
            for _ in 0..3 {
                let mut l = Vec::new();
                r.read_until(b'\n', &mut l).await.unwrap();
                got.push(codec::decode(&l));
            }
            w.write_all(&codec::encode(reply)).await.unwrap();
            let mut l = Vec::new();
            r.read_until(b'\n', &mut l).await.unwrap();
            got.push(codec::decode(&l));
            got
        });
        let result = register("127.0.0.1", port, "勇者", "abc123", 2, "").await;
        (server.await.unwrap(), result)
    }

    #[tokio::test]
    async fn creates_character() {
        let (sent, result) = run("#name 勇者\n#set-user-id ABCDE12345abc123\n").await;
        assert_eq!(
            sent,
            [
                "#ex-register start\n",
                "name=\"勇者\" pass=abc123 image=2 mail=\n",
                "#ex-register end\n",
                "#x\n"
            ]
        );
        assert!(matches!(result, Ok(Outcome::Created(uid)) if uid == "ABCDE12345abc123"));
    }

    #[tokio::test]
    async fn rejected_by_server() {
        let (_, result) = tokio::time::timeout(Duration::from_secs(5), async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            tokio::spawn(async move {
                let (mut sock, _) = listener.accept().await.unwrap();
                sock.write_all(b"#ex-register reject name mail\n").await.unwrap();
                let mut b = [0u8; 256];
                let _ = sock.read(&mut b).await;
            });
            ((), register("127.0.0.1", port, "勇者", "abc123", 0, "").await)
        })
        .await
        .unwrap();
        assert!(matches!(result, Ok(Outcome::Rejected(f)) if f == ["name", "mail"]));
    }
}
