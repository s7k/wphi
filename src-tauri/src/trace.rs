//! 時刻の記録(#44)。地図が止まって見える時に、どこで遅れているかを調べる為の物。
//!
//! ツールのメニューで始めると、ログフォルダの `trace-<時刻>.txt` に1行ずつ「UNIX 時刻のミリ秒 出来事」を書く。
//! 書くのは送受信した行の先頭の語、窓の間の受け渡し、描画、キーの押し離しだけ。発言の中身は書かない。

use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ON: AtomicBool = AtomicBool::new(false);
static FILE: Mutex<Option<File>> = Mutex::new(None);

pub fn on() -> bool {
    ON.load(Ordering::Relaxed)
}

pub fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// dir に新しいファイルを作って記録を始める。作ったファイルを返す
pub fn start(dir: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("trace-{}.txt", now_ms() as u64));
    *FILE.lock().unwrap() = Some(File::create(&path)?);
    ON.store(true, Ordering::Relaxed);
    Ok(path)
}

pub fn stop() {
    ON.store(false, Ordering::Relaxed);
    *FILE.lock().unwrap() = None;
}

/// at(UNIX 時刻のミリ秒)の出来事を1行書く。止まっていれば何もしない
pub fn write_at(at: f64, what: &str) {
    if !on() {
        return;
    }
    // ponytail: 1行ごとに書き込む。記録は1秒に数十行なので、まとめて書くほどの量は無い
    if let Some(f) = FILE.lock().unwrap().as_mut() {
        let _ = writeln!(f, "{at:.1} {}", what.replace(['\r', '\n'], " "));
    }
}

pub fn write(what: &str) {
    if on() {
        write_at(now_ms(), what);
    }
}

/// 送受信した行のうち、記録に書く部分。移動と回転は行ごと、# で始まる行は先頭の語、それ以外(発言など)は書かない
pub fn head(line: &str) -> &str {
    if line.starts_with("go ") || line.starts_with("turn ") || line == "go" {
        return line;
    }
    if line.starts_with('#') {
        return line.split(' ').next().unwrap_or(line);
    }
    "(text)"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn head_hides_text() {
        assert_eq!(head("go N"), "go N");
        assert_eq!(head("turn l"), "turn l");
        assert_eq!(head("#map C00:2 2 N name"), "#map");
        assert_eq!(head("#map-iv 10"), "#map-iv");
        assert_eq!(head("こんにちは"), "(text)");
        assert_eq!(head("gold 10"), "(text)");
    }

    #[test]
    fn writes_only_while_on() {
        let dir = std::env::temp_dir().join(format!("wphi-trace-{}", std::process::id()));
        write("before");
        let path = start(&dir).unwrap();
        write_at(1.0, "recv #map");
        stop();
        write("after");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "1.0 recv #map\n");
        let _ = std::fs::remove_dir_all(dir);
    }
}
