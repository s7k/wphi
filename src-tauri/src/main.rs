#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets;
mod characters;
mod jsonfile;
mod menu;
mod register;
mod session;
mod settings;
mod sounds;
mod trace;

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU32, Ordering},
    },
};

use assets::Assets;

use characters::{Character, Store};
use session::{Login, UiEvent};
use tauri::{Manager, State, ipc::Channel};
use tokio::sync::mpsc;

/// 接続中のキャラ。番号 → 送信キュー。
#[derive(Default)]
struct Sessions {
    next: AtomicU32,
    senders: Mutex<HashMap<u32, mpsc::Sender<String>>>,
}

fn store_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("characters.json"))
}

#[tauri::command]
fn list_characters(app: tauri::AppHandle) -> Result<Store, String> {
    Ok(Store::load(&store_path(&app)?))
}

/// キャラを登録する。`id` が空なら ID はそのまま(接続先だけを変える)。
#[tauri::command]
fn save_character(app: tauri::AppHandle, character: Character, id: String) -> Result<(), String> {
    Store::update(&store_path(&app)?, |store| {
        if !id.is_empty() {
            characters::set_id(&character.label, &id)?;
        }
        store.upsert(character);
        Ok(())
    })
}

#[tauri::command]
fn delete_character(app: tauri::AppHandle, label: String) -> Result<(), String> {
    Store::update(&store_path(&app)?, |store| {
        store.characters.retain(|c| c.label != label);
        store.open_tabs.retain(|l| *l != label);
        characters::delete_id(&label);
        Ok(())
    })
}

#[tauri::command]
fn set_open_tabs(app: tauri::AppHandle, labels: Vec<String>) -> Result<(), String> {
    Store::update(&store_path(&app)?, |store| {
        store.open_tabs = labels;
        Ok(())
    })
}

/// 画像を探す場所。取り込んだ Philly フォルダ → アプリを置いたフォルダ → 実行ファイルに埋め込んだ同梱の分の順。
/// 配布の zip には、アプリの隣に空の `chara` と `chip` を入れてある(`tools/package.sh`)。
fn load_assets(app: &tauri::AppHandle) -> Result<Assets, String> {
    let store = Store::load(&store_path(app)?);
    let portable = std::env::current_exe()
        .ok()
        .and_then(|exe| app_folder(&exe, std::env::var_os("APPIMAGE").map(Into::into)));
    Ok(Assets::new(
        store
            .philly_folder
            .map(Into::into)
            .into_iter()
            .chain(portable)
            .collect(),
    ))
}

/// 利用者がアプリを置いたフォルダ。
/// - AppImage は、実行ファイルが展開先の一時フォルダにあるので、`APPIMAGE` の指す AppImage の隣
/// - macOS は `WPHI.app/Contents/MacOS/wphi` なので、`WPHI.app` を含むフォルダ
/// - それ以外(Windows など)は実行ファイルの隣
fn app_folder(exe: &std::path::Path, appimage: Option<std::path::PathBuf>) -> Option<std::path::PathBuf> {
    if let Some(a) = appimage {
        return a.parent().map(Into::into);
    }
    let dir = exe.parent()?;
    let app_bundle = dir.ancestors().find(|p| p.extension().is_some_and(|e| e == "app"));
    match app_bundle {
        Some(bundle) => bundle.parent().map(Into::into),
        None => Some(dir.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::app_folder;
    use std::path::{Path, PathBuf};

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
    fn stays_in_app() {
        let ok = |s: &str| super::is_app_url(&tauri::Url::parse(s).unwrap());
        assert!(ok("tauri://localhost/map.html"));
        assert!(ok("http://tauri.localhost/"));
        assert!(ok("http://localhost:5173/"));
        assert!(!ok("https://evil.example/"));
        assert!(!ok("http://localhost.evil.example/"));
        assert!(!ok("file:///etc/passwd"));
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

    #[test]
    fn dir_name_is_safe_on_windows() {
        use super::dir_name;
        assert_eq!(dir_name("勇者/A:B"), "勇者_A_B");
        assert_eq!(dir_name(" a. "), "a");
        assert_eq!(dir_name(".."), "_");
        assert_eq!(dir_name("con"), "con_");
        assert_eq!(dir_name("NUL.txt"), "NUL.txt_");
        assert_eq!(dir_name("COM1"), "COM1_");
        assert_eq!(dir_name("COMET"), "COMET");
    }

    #[test]
    fn finds_the_folder_the_user_put_the_app_in() {
        assert_eq!(
            app_folder(Path::new("/Users/a/WPHI/WPHI.app/Contents/MacOS/wphi"), None),
            Some(PathBuf::from("/Users/a/WPHI"))
        );
        assert_eq!(
            app_folder(
                Path::new("/tmp/.mount_X/usr/bin/wphi"),
                Some("/home/a/WPHI/WPHI.AppImage".into())
            ),
            Some(PathBuf::from("/home/a/WPHI"))
        );
        assert_eq!(
            app_folder(Path::new("C:/Games/WPHI/WPHI.exe"), None),
            Some(PathBuf::from("C:/Games/WPHI"))
        );
    }
}

/// 効果音の規則。Philly フォルダが無ければ鳴らさない。
fn load_sounds(app: &tauri::AppHandle) -> sounds::Sounds {
    store_path(app)
        .ok()
        .and_then(|p| Store::load(&p).philly_folder)
        .map(|f| sounds::Sounds::load(std::path::Path::new(&f)))
        .unwrap_or_default()
}

/// Philly フォルダの `*.chara/.phirc` を登録する。登録した表示名を返す。
/// フォルダは覚えておき、以後の画像もここから先に探す。
#[tauri::command]
fn import_philly(
    app: tauri::AppHandle,
    folder: String,
    assets: State<'_, Mutex<Arc<Assets>>>,
) -> Result<Vec<String>, String> {
    let labels = Store::update(&store_path(&app)?, |store| {
        store.philly_folder = Some(folder.clone());
        let mut labels = Vec::new();
        for p in characters::read_philly(std::path::Path::new(&folder))? {
            characters::set_id(&p.character.label, &p.id)?;
            labels.push(p.character.label.clone());
            store.upsert(p.character);
        }
        Ok(labels)
    })?;
    *assets.lock().unwrap() = Arc::new(load_assets(&app)?);
    *app.state::<Mutex<Arc<sounds::Sounds>>>().lock().unwrap() = Arc::new(load_sounds(&app));
    Ok(labels)
}

/// `phi-asset://localhost/<種類>?...` に PNG を返す。種類は chara・chip・items。sound は WAV、cursor はスキンのカーソル
fn asset_response(app: &tauri::AppHandle, uri: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    let Ok(url) = tauri::Url::parse(uri) else {
        return not_found();
    };
    let kind = url.path().trim_start_matches('/').to_string();
    let query = url.query_pairs().into_owned().collect();
    if kind == "sound" {
        let sounds = app.state::<Mutex<Arc<sounds::Sounds>>>().lock().unwrap().clone();
        let wav = url
            .query_pairs()
            .find(|(k, _)| k == "no")
            .and_then(|(_, v)| v.parse().ok())
            .and_then(|no| sounds.wav(no));
        return match wav {
            Some(b) => tauri::http::Response::builder()
                .header("Content-Type", "audio/wav")
                .body(b)
                .unwrap(),
            None => not_found(),
        };
    }
    let assets = app.state::<Mutex<Arc<Assets>>>().lock().unwrap().clone();
    if kind == "cursor" {
        let name = url
            .query_pairs()
            .find(|(k, _)| k == "name")
            .map(|(_, v)| v.into_owned());
        return match name.and_then(|n| assets.cursor(&n)) {
            Some(b) => tauri::http::Response::builder()
                .header("Content-Type", "image/x-icon")
                .body(b)
                .unwrap(),
            None => not_found(),
        };
    }
    match assets.get(&kind, &query) {
        Some(png) => tauri::http::Response::builder()
            .header("Content-Type", "image/png")
            .body(png)
            .unwrap(),
        None => not_found(),
    }
}

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json"))
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<settings::Settings, String> {
    Ok(settings::Settings::load(&settings_path(&app)?))
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: settings::Settings) -> Result<(), String> {
    settings.save(&settings_path(&app)?)?;
    // map 窓もマップの拡大率などを読むので、全部の窓へ知らせる
    let _ = tauri::Emitter::emit(&app, menu::EXPERIMENT_EVENT, &settings);
    Ok(())
}

/// 取り込んだ Philly フォルダの `Config/Philly.ini` から設定を取り込んで保存する。
#[tauri::command]
fn import_philly_settings(app: tauri::AppHandle) -> Result<settings::Settings, String> {
    let folder = Store::load(&store_path(&app)?)
        .philly_folder
        .ok_or("先に Philly フォルダからキャラを取り込んでください")?;
    let ini = std::path::Path::new(&folder).join("Config").join("Philly.ini");
    let bytes = std::fs::read(&ini).map_err(|e| format!("{}: {e}", ini.display()))?;
    jsonfile::update(&settings_path(&app)?, |s: &mut settings::Settings| {
        s.import_philly_ini(&bytes);
        Ok(s.clone())
    })
}

/// 新規キャラ作成で選べる初期グラの名前。
#[tauri::command]
async fn register_graphics(host: String, port: u16) -> Result<Vec<String>, String> {
    register::graphics(&host, port).await
}

/// 新規キャラを作り、そのまま一覧に登録する。表示名はキャラ名にする。
#[tauri::command]
async fn register_character(
    app: tauri::AppHandle,
    host: String,
    port: u16,
    name: String,
    pass: String,
    image: u32,
    mail: String,
) -> Result<String, String> {
    match register::register(&host, port, &name, &pass, image, &mail).await? {
        register::Outcome::Created(id) => {
            Store::update(&store_path(&app)?, |store| {
                characters::set_id(&name, &id)?;
                store.upsert(Character {
                    label: name.clone(),
                    host,
                    port,
                });
                Ok(())
            })?;
            Ok(name)
        }
        register::Outcome::Rejected(fields) => {
            let label = |f: &str| match f {
                "name" => "名前",
                "pass" => "パスワード",
                "image" => "キャラグラ",
                "mail" => "メール",
                _ => "不明な項目",
            };
            let fields: Vec<&str> = fields.iter().map(|f| label(f)).collect();
            Err(format!("作れませんでした。{} を見直してください", fields.join("・")))
        }
    }
}

/// 登録したキャラで接続する。ID はキーチェーンから読み、UI には渡さない。
#[tauri::command]
fn connect(
    app: tauri::AppHandle,
    label: String,
    on_event: Channel<UiEvent>,
    sessions: State<'_, Sessions>,
) -> Result<u32, String> {
    let store = Store::load(&store_path(&app)?);
    let ch = store
        .find(&label)
        .ok_or_else(|| format!("{label} は登録されていません"))?
        .clone();
    let id = characters::get_id(&label)?;
    let (host, port) = (ch.host, ch.port);
    let no = sessions.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel(64);
    sessions.senders.lock().unwrap().insert(no, tx);
    let store = store_path(&app)?;
    let cleanup = app.clone();
    tauri::async_runtime::spawn(async move {
        session::run(Login { host, port, id }, rx, move |ev| {
            // 世界移動したら、登録したキャラの接続先を書き換える(Philly の RewriteSaveData)
            if let UiEvent::Ui(session::UiOnly::WorldMoved { host, port }) = &ev {
                let r = Store::update(&store, |s| {
                    if let Some(c) = s.characters.iter_mut().find(|c| c.label == label) {
                        c.host = host.clone();
                        c.port = *port;
                    }
                    Ok(())
                });
                if let Err(e) = r {
                    eprintln!("接続先を保存出来ません: {e}");
                }
            }
            // 効果音(Philly の SoundPlay)と、タスクバーを点滅させない行。システムの行は照合しない
            let mut ev = ev;
            let sound = match &mut ev {
                UiEvent::Ui(session::UiOnly::Log { text, no_flash, .. }) if !text.is_empty() => {
                    let sounds = app.state::<Mutex<Arc<sounds::Sounds>>>().lock().unwrap().clone();
                    *no_flash = sounds.no_flash(text);
                    sounds.find(text).map(|no| (no, sounds.has_file(no)))
                }
                _ => None,
            };
            // UI の窓が閉じていれば送れないだけなので、失敗は無視する
            let _ = on_event.send(ev);
            if let Some((no, file)) = sound {
                let _ = on_event.send(UiEvent::Ui(session::UiOnly::Sound { no, file }));
            }
        })
        .await;
        // サーバ側から切れた時も送信キューを消す。消すのが disconnect だけだと、切れた接続の分が残り続ける(#72)
        cleanup.state::<Sessions>().senders.lock().unwrap().remove(&no);
    });
    Ok(no)
}

/// 1行を送る。改行を含む文字列は送らない。UI のどこかに穴があっても、1回の送信にサーバのコマンドの行を
/// 差し込ませない為(#54)。複数行を送るのは send_lines だけにする
#[tauri::command]
async fn send_line(session: u32, text: String, sessions: State<'_, Sessions>) -> Result<(), String> {
    send(&sessions, session, vec![text]).await
}

/// 複数行を順に送る(看板の本文、F8〜F12 と Alt+G の \n)。
#[tauri::command]
async fn send_lines(session: u32, lines: Vec<String>, sessions: State<'_, Sessions>) -> Result<(), String> {
    send(&sessions, session, lines).await
}

async fn send(sessions: &Sessions, session: u32, lines: Vec<String>) -> Result<(), String> {
    if lines.iter().any(|l| l.contains(['\r', '\n'])) {
        return Err("改行を含む行は送れません".into());
    }
    let tx = sessions.senders.lock().unwrap().get(&session).cloned();
    let tx = tx.ok_or("接続していません")?;
    for l in lines {
        trace::write(&format!("send {}", trace::head(&l)));
        tx.send(l).await.map_err(|_| "接続が切れています".to_string())?;
    }
    Ok(())
}

/// 接続中のセッションに #x を送らせてからアプリを終える。送信キューを閉じると session::run が #x を送って終わる。
/// 待たずに終えると、tokio のタスクは #x を送る前に捨てられる(#72)
fn exit_app(app: &tauri::AppHandle) {
    let connected = {
        let sessions = app.state::<Sessions>();
        let mut senders = sessions.senders.lock().unwrap();
        let connected = !senders.is_empty();
        senders.clear();
        connected
    };
    if connected {
        // ponytail: 決め打ちで待つ。遅い回線で足りなければ、各タスクの終わりを待つ形にする
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
    app.exit(0);
}

#[tauri::command]
fn disconnect(session: u32, sessions: State<'_, Sessions>) {
    // 送信キューを閉じると、接続のタスクが #x を送って終わる
    sessions.senders.lock().unwrap().remove(&session);
}

/// ログの保存先のフォルダ(`<アプリのログフォルダ>/<表示名>`)。
fn log_dir(app: &tauri::AppHandle, label: &str) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?
        .join(dir_name(label)))
}

/// アプリ自身のページか。配布物は tauri://localhost(macOS・Linux)か http://tauri.localhost(Windows)、
/// 開発中は devUrl(http://localhost:5173)
fn is_app_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        // about:blank は WebView が作られた直後に開く
        "tauri" | "about" => true,
        "http" | "https" => matches!(url.host_str(), Some("tauri.localhost" | "localhost")),
        _ => false,
    }
}

/// 表示名をフォルダ名にする。ファイル名に使えない文字は `_` にし、前後の `.` と空白を落とす
/// (Windows は末尾の `.` と空白を落とすので、`a.` が `a` と同じフォルダになる)。
/// `CON`・`NUL` などの Windows の予約名は、デバイスを指してしまうので `_` を足す。
fn dir_name(label: &str) -> String {
    let safe: String = label
        .chars()
        .map(|c| {
            if c.is_control() || r#"/\:*?"<>|"#.contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let safe = safe.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if safe.is_empty() {
        return "_".into();
    }
    let stem = safe.split('.').next().unwrap_or(safe).to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved { format!("{safe}_") } else { safe.into() }
}

/// ログを日ごとの HTML に足す(Philly の LogAutoSave と LogSaveHtml=on)。`date` は UI が決めた利用者の地域の日付(yyyymmdd)。
/// 新しいファイルにはスキンの Log.css を埋め込み、ブラウザで開いた時もログ欄と同じ見た目にする。
// async にして、メインスレッドの外でファイルを開く(1行ごとに呼ぶので、同期だと UI を止める)
#[tauri::command]
async fn append_log(
    app: tauri::AppHandle,
    label: String,
    date: String,
    html: String,
    as_html: bool,
) -> Result<String, String> {
    if date.len() != 8 || !date.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("日付が不正: {date}"));
    }
    let dir = log_dir(&app, &label)?;
    // テキストで保存する時(Philly の LogSaveHtml=off)は、タグを除いた文字だけを <日付>.txt に書く
    let (path, line) = if as_html {
        (dir.join(format!("{date}.html")), format!("<div>{html}</div>\n"))
    } else {
        (dir.join(format!("{date}.txt")), format!("{}\n", html_to_text(&html)))
    };
    // 開いたファイルは覚えておき、1行ごとに開き直さない(#65)。UI が1つ前の書き込みを待ってから呼ぶので、順番は保たれる
    static OPEN: std::sync::Mutex<Vec<(std::path::PathBuf, std::fs::File)>> = std::sync::Mutex::new(Vec::new());
    let head = || {
        as_html.then(|| {
            let css = log_css().unwrap_or_default();
            let title = phi_proto::tag_to_html::escape_html(&label);
            format!(
                "<!doctype html>\n<meta charset=\"utf-8\">\n<title>{title} {date}</title>\n<style>\n{css}\n</style>\n"
            )
        })
    };
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

/// 設定フォルダ(characters.json と settings.json の置き場)を開く
#[tauri::command]
async fn open_config_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// 時刻の記録(#44)を始めるか止める。始めた時は書き出すファイルを返す。全部の窓へ phi-trace で知らせる
#[tauri::command]
fn set_trace(app: tauri::AppHandle, on: bool) -> Result<Option<String>, String> {
    use tauri::Emitter;
    let path = if on {
        let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
        Some(trace::start(&dir).map_err(|e| e.to_string())?.display().to_string())
    } else {
        trace::stop();
        None
    };
    let _ = app.emit("phi-trace", on);
    Ok(path)
}

/// main 窓のメニューの、表示のモードのチェックを付け直す(UI が地図を受けた時とメニューを選んだ時に呼ぶ)
#[tauri::command]
fn set_view_checks(app: tauri::AppHandle, turn: bool, size57: bool) {
    if let Some(menu) = app.get_webview_window("main").and_then(|w| w.menu()) {
        menu::set_view_checks(&menu, turn, size57);
    }
}

#[tauri::command]
fn trace_on() -> bool {
    trace::on()
}

/// UI の出来事を記録する。at は UI の時計の UNIX 時刻のミリ秒(受け渡しの遅れを含めない為)
#[tauri::command]
fn trace(at: f64, what: String) {
    trace::write_at(at, &what);
}

/// 表示名のログの保存先のフォルダを、OS のファイルマネージャで開く。無ければ作る
#[tauri::command]
async fn open_log_dir(app: tauri::AppHandle, label: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = log_dir(&app, &label)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// ログと同じ HTML にする(看板エディタのプレビュー。Philly の MEditForm も TagToHtml を使う)。
#[tauri::command]
fn log_html(text: String) -> String {
    phi_proto::tag_to_html::to_html(&text, &phi_proto::tag_to_html::LogOptions::default())
}

/// スキンのログ用スタイルシート(Philly の `Skins/<スキン>/Style/Log.css`)。
#[tauri::command]
fn log_css() -> Result<String, String> {
    let css = assets::bundled("Skins/Mine/Style/Log.css").ok_or("同梱の Log.css がありません")?;
    Ok(String::from_utf8_lossy(css).into_owned())
}

/// GNOME(Wayland)と ibus では、Wayland のまま動かすと IME の変換候補がカーソルから離れた位置に出る。
/// X11(XWayland)で動かし、GTK の ibus モジュールを使うと正しい位置に出る。
/// 利用者が指定した値は変えない。
#[cfg(target_os = "linux")]
fn prefer_x11_ime() {
    let unset = |k| std::env::var_os(k).is_none();
    // SAFETY: GTK とスレッドを起動する前に呼ぶ
    unsafe {
        if unset("GDK_BACKEND") {
            std::env::set_var("GDK_BACKEND", "x11");
        }
        if unset("GTK_IM_MODULE") && std::env::var("XMODIFIERS").is_ok_and(|v| v.contains("ibus")) {
            std::env::set_var("GTK_IM_MODULE", "ibus");
        }
    }
}

/// wry は Linux で IME の preedit を無効にしている(wry 0.57 `webkitgtk/mod.rs` の `set_webview_settings`)。
/// 無効のままだと未確定の文字が入力欄に出ないので、有効に戻す。
/// wry が無効にしたのは fcitx の候補の窓をカーソル位置に合わせる為で、ibus(X11)では有効でも候補の位置は合う。
#[cfg(target_os = "linux")]
fn enable_ime_preedit(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| {
        use webkit2gtk::{InputMethodContextExt, WebViewExt};
        if let Some(ctx) = webview.inner().input_method_context() {
            ctx.set_enable_preedit(true);
        }
    });
}

fn main() {
    #[cfg(target_os = "linux")]
    prefer_x11_ime();

    tauri::Builder::default()
        .setup(|app| {
            app.manage(Mutex::new(Arc::new(load_assets(app.handle())?)));
            app.manage(Mutex::new(Arc::new(load_sounds(app.handle()))));
            // メニューバーは main 窓だけに付ける
            let menu_txt = assets::bundled("Skins/Mine/Style/Menu.txt")
                .map(phi_proto::codec::decode)
                .unwrap_or_default();
            if let Some(main) = app.get_webview_window("main") {
                let settings = settings_path(app.handle())
                    .map(|p| settings::Settings::load(&p))
                    .unwrap_or_default();
                main.set_menu(menu::build(app.handle(), &menu_txt, &settings)?)?;
            }
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                enable_ime_preedit(&window);
            }
            Ok(())
        })
        // main 窓を閉じたらアプリを終える。map と EagleEye は閉じても隠すだけなので、残ったままだとアプリが終わらず、
        // window-state が窓の位置を書き出す RunEvent::Exit も来ない(窓の位置が保存されなかった)
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                exit_app(window.app_handle());
            }
        })
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            if event.id().0 == "exit" {
                exit_app(app);
                return;
            }
            let id = event.id().0.as_str();
            if menu::experiment(&mut settings::Settings::default(), id).is_some() {
                let saved = settings_path(app).and_then(|p| {
                    jsonfile::update(&p, |s: &mut settings::Settings| {
                        if let Some(v) = menu::experiment(s, id) {
                            *v = !*v;
                        }
                        Ok(s.clone())
                    })
                });
                match saved {
                    Ok(s) => {
                        let _ = app.emit(menu::EXPERIMENT_EVENT, s);
                    }
                    Err(e) => eprintln!("設定を保存出来ません: {e}"),
                }
                return;
            }
            let _ = app.emit_to("main", menu::MENU_EVENT, event.id().0.clone());
        })
        // 画像の変換は UI のイベントループの外で行う。Windows(WebView2)は要求を UI スレッドで受けるので、
        // 同期で変換すると、変換が終わるまで全部の窓が止まる
        .register_asynchronous_uri_scheme_protocol("phi-asset", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            let uri = req.uri().to_string();
            tauri::async_runtime::spawn_blocking(move || responder.respond(asset_response(&app, &uri)));
        })
        .plugin(tauri_plugin_opener::init())
        // 窓の位置と大きさを覚え、次に開いた時に戻す(#17)。map と EagleEye は閉じると隠すだけなので、
        // 見えているかは戻さない(起動した時に EagleEye が出てしまう)
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all() - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        // 窓が自分のページ以外へ移らないようにする(#49)。リンクは UI が既定のブラウザで開く
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("stay-in-app")
                .on_navigation(|_, url| {
                    let ok = is_app_url(url);
                    if !ok {
                        eprintln!("窓の遷移を止めました: {url}");
                    }
                    ok
                })
                .build(),
        )
        .manage(Sessions::default())
        .invoke_handler(tauri::generate_handler![
            list_characters,
            save_character,
            delete_character,
            set_open_tabs,
            import_philly,
            register_graphics,
            get_settings,
            save_settings,
            import_philly_settings,
            register_character,
            connect,
            send_line,
            send_lines,
            open_log_dir,
            open_config_dir,
            disconnect,
            log_css,
            log_html,
            append_log,
            set_trace,
            set_view_checks,
            trace_on,
            trace
        ])
        .run(tauri::generate_context!())
        .expect("Tauri の起動に失敗した");
}
