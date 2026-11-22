//! ログの保存(日ごとのファイル、ログバッファー保存)と、ログの HTML の見た目。

use tauri::Manager;

/// ログの保存先のフォルダ(`<アプリのログフォルダ>/<表示名>`)。
pub fn log_dir(app: &tauri::AppHandle, label: &str) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?
        .join(crate::dir_name(label)))
}

/// ログを日ごとの HTML に足す(Philly の LogAutoSave と LogSaveHtml=on)。`date` は UI が決めた利用者の地域の日付(yyyymmdd)。
/// 新しいファイルにはログの CSS を埋め込み、ブラウザで開いた時もログ欄と同じ見た目にする。
// async にして、メインスレッドの外でファイルを開く(1行ごとに呼ぶので、同期だと UI を止める)
#[tauri::command]
pub async fn append_log(
    app: tauri::AppHandle,
    label: String,
    date: String,
    lines: Vec<String>,
    as_html: bool,
) -> Result<String, String> {
    if date.len() != 8 || !date.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("日付が不正: {date}"));
    }
    let dir = log_dir(&app, &label)?;
    // テキストで保存する時(Philly の LogSaveHtml=off)は、タグを除いた文字だけを <日付>.txt に書く
    // UI は書き込みを待つ間に届いた行をまとめて渡す (#122)
    let (path, line) = if as_html {
        (
            dir.join(format!("{date}.html")),
            lines.iter().map(|h| format!("<div>{h}</div>\n")).collect::<String>(),
        )
    } else {
        (
            dir.join(format!("{date}.txt")),
            lines
                .iter()
                .map(|h| format!("{}\n", html_to_text(h)))
                .collect::<String>(),
        )
    };
    // 開いたファイルは覚えておき、1行ごとに開き直さない(#65)。UI が1つ前の書き込みを待ってから呼ぶので、順番は保たれる
    static OPEN: std::sync::Mutex<Vec<(std::path::PathBuf, std::fs::File)>> = std::sync::Mutex::new(Vec::new());
    let head = || as_html.then(|| log_html_head(&format!("{label} {date}")));
    write_log(&mut OPEN.lock().unwrap_or_else(|e| e.into_inner()), &path, &line, head)?;
    Ok(path.display().to_string())
}

/// ログのファイルに1行足す。`open` は開いたままのファイル。新しいファイルには先に `head` を書く。
/// 同じフォルダ(同じタブ)の別のファイル(前の日付)は閉じる
fn write_log(
    open: &mut Vec<(std::path::PathBuf, std::fs::File)>,
    path: &std::path::Path,
    line: &str,
    head: impl FnOnce() -> Option<String>,
) -> Result<(), String> {
    use std::io::Write;
    if !open.iter().any(|(p, _)| p == path) {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let new = !path.exists();
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        if let Some(head) = new.then(head).flatten() {
            f.write_all(head.as_bytes()).map_err(|e| e.to_string())?;
        }
        open.retain(|(p, _)| p.parent() != path.parent());
        open.push((path.to_path_buf(), f));
    }
    let f = &mut open.iter_mut().find(|(p, _)| p == path).unwrap().1;
    // 1行を1回の write で書く(writeln! は部品ごとに write を出す)
    let written = f.write_all(line.as_bytes());
    if written.is_err() {
        // 書けなければ、次は開き直す
        open.retain(|(p, _)| p != path);
    }
    written.map_err(|e| e.to_string())
}

/// ログの1行の HTML から文字だけを取り出す。タグを除き、文字参照を戻す。改行(<br>)は空白にする
fn html_to_text(html: &str) -> String {
    let mut out = String::new();
    let mut rest = html;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        let tag = &rest[i..];
        let end = tag.find('>').map_or(tag.len(), |e| e + 1);
        if tag[..end].to_ascii_lowercase().starts_with("<br") {
            out.push(' ');
        }
        rest = &tag[end..];
    }
    out.push_str(rest);
    [
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", "\""),
        ("&#39;", "'"),
        ("&nbsp;", " "),
        ("&hearts;", "♥"),
        ("&amp;", "&"),
    ]
    .iter()
    .fold(out, |s, (from, to)| s.replace(from, to))
}

/// 表示名のログの保存先のフォルダを、OS のファイルマネージャで開く。無ければ作る
#[tauri::command]
pub async fn open_log_dir(app: tauri::AppHandle, label: String) -> Result<(), String> {
    crate::open_dir(&app, log_dir(&app, &label)?)
}

/// ログと同じ HTML にする(看板エディタのプレビュー。Philly の MEditForm も TagToHtml を使う)。
#[tauri::command]
pub fn log_html(text: String) -> String {
    phi_proto::tag_to_html::to_html(&text, &phi_proto::tag_to_html::LogOptions::default())
}

/// ログバッファー保存(Philly の LogBufferSave。#80)。ログ欄にある分を、ログのフォルダに
/// `LogBuffer-<日時>.html` で書く。Philly は保存先を選ばせるが、WPHI はファイルを選ぶ窓を持たない
#[tauri::command]
pub fn save_log_buffer(app: tauri::AppHandle, label: String, lines: Vec<String>) -> Result<String, String> {
    let dir = log_dir(&app, &label)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let path = dir.join(format!("LogBuffer-{secs}.html"));
    let body: String = lines.iter().map(|l| format!("<div>{l}</div>\n")).collect();
    let html = log_html_head(&label) + &body;
    std::fs::write(&path, html).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.display().to_string())
}

/// ログの HTML の頭。ログの CSS を埋め込み、ブラウザで開いた時もログ欄と同じ見た目にする
fn log_html_head(title: &str) -> String {
    let css = log_css().unwrap_or_default();
    let title = phi_proto::tag_to_html::escape_html(title);
    format!("<!doctype html>\n<meta charset=\"utf-8\">\n<title>{title}</title>\n<style>\n{css}\n</style>\n")
}

/// ログのスタイルシート。Philly のスキンの `Style/Log.css` の代わりに WPHI で書いた物(resources/phi/wphi/log.css)
#[tauri::command]
pub fn log_css() -> Result<String, String> {
    let css = crate::assets::bundled("wphi/log.css").ok_or("同梱の log.css がありません")?;
    Ok(String::from_utf8_lossy(css).into_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    fn log_writes_head_once_and_closes_old_day() {
        let dir = std::env::temp_dir().join(format!("wphi-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut open = Vec::new();
        let day1 = dir.join("a").join("20261108.html");
        let day2 = dir.join("a").join("20261109.html");
        let head = || Some("H\n".to_string());
        super::write_log(&mut open, &day1, "1\n", head).unwrap();
        super::write_log(&mut open, &day1, "2\n", head).unwrap();
        assert_eq!(std::fs::read_to_string(&day1).unwrap(), "H\n1\n2\n");
        // 日付が変わったら前の日のファイルを閉じる
        super::write_log(&mut open, &day2, "3\n", head).unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(std::fs::read_to_string(&day2).unwrap(), "H\n3\n");
        // 一度閉じた既存のファイルには、見出しを書き直さない
        super::write_log(&mut open, &day1, "4\n", head).unwrap();
        assert_eq!(std::fs::read_to_string(&day1).unwrap(), "H\n1\n2\n4\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn html_to_text() {
        assert_eq!(
            super::html_to_text(r#"12:00 <font class="a">勇者</font> &gt; a&amp;b<br class="phi_tag">&lt;c&gt;"#),
            "12:00 勇者 > a&b <c>"
        );
        // &amp;lt; は &lt; のまま
        assert_eq!(super::html_to_text("&amp;lt;"), "&lt;");
    }
}
