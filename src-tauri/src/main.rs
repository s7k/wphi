#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets;
mod auto_unequip;
mod characters;
mod download;
mod jsonfile;
mod logs;
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
    /// 接続のタスク。強制切断で止める(#77)
    tasks: Mutex<HashMap<u32, tauri::async_runtime::JoinHandle<()>>>,
    /// 地図の窓から決めた視界の大きさ(v6)。地図の窓は1つなので、全部のセッションで同じ大きさを要求する
    view: Mutex<Option<(u8, u8)>>,
}

/// 設定フォルダ(characters.json・settings.json と、キャラの .phirc の置き場)。
/// macOS と Linux は ~/.config/wphi。Windows は OS の決める場所(%APPDATA%\dev.wphi)
fn config_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    #[cfg(windows)]
    return app.path().app_config_dir().map_err(|e| e.to_string());
    #[cfg(not(windows))]
    Ok(app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join(".config")
        .join("wphi"))
}

/// 前の版の設定フォルダ(macOS は ~/Library/Application Support/dev.wphi、Linux は ~/.config/dev.wphi)から、
/// 新しい設定フォルダへ characters.json と settings.json を写す。新しい方にあれば写さない
fn migrate_config(app: &tauri::AppHandle) {
    let (Ok(old), Ok(new)) = (app.path().app_config_dir(), config_dir(app)) else {
        return;
    };
    if old == new {
        return;
    }
    for name in ["characters.json", "settings.json"] {
        let (from, to) = (old.join(name), new.join(name));
        if from.exists() && !to.exists() && std::fs::create_dir_all(&new).is_ok() {
            let _ = std::fs::copy(&from, &to);
        }
    }
}

fn store_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(config_dir(app)?.join("characters.json"))
}

#[tauri::command]
fn list_characters(app: tauri::AppHandle) -> Result<Store, String> {
    Ok(Store::load(&store_path(&app)?))
}

/// キャラを登録する。`id` が空なら ID はそのまま(接続先だけを変える)。
#[tauri::command]
fn save_character(app: tauri::AppHandle, character: Character, id: String) -> Result<(), String> {
    Store::update(&store_path(&app)?, |store| {
        store.check(&character.label, &id)?;
        let dir = config_dir(&app)?;
        if !id.is_empty() {
            characters::set_id(&dir, &character, &id)?;
        } else if store.find(&character.label).is_some_and(|old| *old != character) {
            // 接続先だけを変えた時も、.phirc の接続先を書き換える
            if let Ok(old_id) = characters::get_id(&dir, &character) {
                characters::set_id(&dir, &character, &old_id)?;
            }
        }
        store.upsert(character);
        Ok(())
    })?;
    refresh_character_menu(&app);
    Ok(())
}

#[tauri::command]
fn delete_character(app: tauri::AppHandle, label: String) -> Result<(), String> {
    Store::update(&store_path(&app)?, |store| {
        store.characters.retain(|c| c.label != label);
        store.open_tabs.retain(|l| *l != label);
        characters::delete_id(&config_dir(&app)?, &label);
        Ok(())
    })?;
    refresh_character_menu(&app);
    Ok(())
}

#[tauri::command]
fn set_open_tabs(app: tauri::AppHandle, labels: Vec<String>) -> Result<(), String> {
    Store::update(&store_path(&app)?, |store| {
        store.open_tabs = labels;
        Ok(())
    })
}

/// 画像を探す場所。取り込んだ Philly フォルダ → アプリを置いたフォルダ → ダウンロードした分 → 実行ファイルに埋め込んだ同梱の分の順。
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
            .chain(data_dir(app).ok())
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
    fn concurrent_downloads_keep_every_date() {
        let dir = std::env::temp_dir().join(format!("wphi-downloaded-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("downloaded.json");
        std::thread::scope(|s| {
            for i in 0..8 {
                let path = &path;
                s.spawn(move || super::remember_download(path, format!("S{i}"), "d".into()).unwrap());
            }
        });
        let got: std::collections::HashMap<String, String> = super::jsonfile::load(&path);
        assert_eq!(got.len(), 8);
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
// async でないコマンドはメインスレッドで動き、フォルダを読む間は全部の窓が止まる (#128)
#[tauri::command]
async fn import_philly(
    app: tauri::AppHandle,
    folder: String,
    assets: State<'_, Mutex<Arc<Assets>>>,
) -> Result<Vec<String>, String> {
    let labels = Store::update(&store_path(&app)?, |store| {
        store.philly_folder = Some(folder.clone());
        let mut labels = Vec::new();
        for p in characters::read_philly(std::path::Path::new(&folder))? {
            store.check(&p.character.label, &p.id)?;
            characters::set_id(&config_dir(&app)?, &p.character, &p.id)?;
            labels.push(p.character.label.clone());
            store.upsert(p.character);
        }
        Ok(labels)
    })?;
    *assets.lock().unwrap() = Arc::new(load_assets(&app)?);
    *app.state::<Mutex<Arc<sounds::Sounds>>>().lock().unwrap() = Arc::new(load_sounds(&app));
    refresh_character_menu(&app);
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
    Ok(config_dir(app)?.join("settings.json"))
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
/// ダウンロードした物の置き場(設定フォルダの `data`)。中は Philly と同じく `chara`・`chip`
fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(config_dir(app)?.join("data"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadRow {
    #[serde(flatten)]
    item: download::Item,
    /// 取った時の配布元の更新日。取っていなければ None
    got: Option<String>,
}

fn download_items_of() -> Vec<download::Item> {
    assets::bundled("Config/unew.ini")
        .map(|b| download::items(&phi_proto::codec::decode(b)))
        .unwrap_or_default()
}

/// 新規接続の設定(resist.ini)の項目。これは一覧に出さず、新規キャラ作成を開いた時に取る
fn is_resist(item: &download::Item) -> bool {
    item.url.to_lowercase().ends_with("/resist.lzh")
}

fn downloaded(app: &tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    Ok(jsonfile::load(&data_dir(app)?.join("downloaded.json")))
}

/// ダウンロード出来る物の一覧と、取った時の更新日
#[tauri::command]
fn download_items(app: tauri::AppHandle) -> Result<Vec<DownloadRow>, String> {
    let got = downloaded(&app)?;
    Ok(download_items_of()
        .into_iter()
        .filter(|i| !is_resist(i))
        .map(|item| DownloadRow {
            got: got.get(&item.id).cloned(),
            item,
        })
        .collect())
}

/// 1つ取って data に展開し、取った時の更新日を覚える。書いたファイルの数を返す
async fn fetch_item(app: &tauri::AppHandle, item: download::Item) -> Result<usize, String> {
    let data = data_dir(app)?;
    let dest = data.join(&item.dir);
    let url = item.url.clone();
    let n = tauri::async_runtime::spawn_blocking(move || download::extract(&download::fetch(&url)?, &dest))
        .await
        .map_err(|e| e.to_string())??
        .len();
    remember_download(&data.join("downloaded.json"), item.id, item.date)?;
    Ok(n)
}

/// downloaded.json に取った時の更新日を足す。取得を2つ同時に動かす事がある(新規キャラ作成の画面と取得の画面)ので、
/// jsonfile::update のロックを通す。通さないと、後から保存した側が先の取得日を消す
fn remember_download(path: &std::path::Path, id: String, date: String) -> Result<(), String> {
    jsonfile::update(path, |got: &mut HashMap<String, String>| {
        got.insert(id, date);
        Ok(())
    })
}

/// 1つ取って展開し、画像を読み直す。書いたファイルの数を返す
#[tauri::command]
async fn download_item(app: tauri::AppHandle, id: String) -> Result<usize, String> {
    let item = download_items_of()
        .into_iter()
        .find(|i| i.id == id)
        .ok_or("一覧に無い物です")?;
    let n = fetch_item(&app, item).await?;
    reload_assets_now(&app)?;
    Ok(n)
}

/// 新規接続の設定(resist.ini)の世界。まだ取っていないか配布元の更新日が変わっていれば、先に取る。
/// 取れなければ前に取った物を使い、それも無ければ同梱の worlds.ini(配布元が見つからない、同じ形の一覧)
#[tauri::command]
async fn register_worlds(app: tauri::AppHandle) -> Result<Vec<download::World>, String> {
    let path = data_dir(&app)?.join("resist.ini");
    if let Some(item) = download_items_of().into_iter().find(is_resist) {
        let current = downloaded(&app)?.get(&item.id) == Some(&item.date);
        if (!current || !path.exists())
            && let Err(e) = fetch_item(&app, item).await
        {
            eprintln!("{e}");
        }
    }
    let got = std::fs::read(path).map(|b| download::worlds(&b)).unwrap_or_default();
    if !got.is_empty() {
        return Ok(got);
    }
    Ok(assets::bundled("Config/worlds.ini")
        .map(download::worlds)
        .unwrap_or_default())
}

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
    // サーバにキャラを作る前に確かめる。作った後に保存出来ないと、ID を失う
    Store::load(&store_path(&app)?).check_new(&name)?;
    match register::register(&host, port, &name, &pass, image, &mail).await? {
        register::Outcome::Created(id) => {
            Store::update(&store_path(&app)?, |store| {
                store.check_new(&name)?;
                let ch = Character {
                    label: name.clone(),
                    host,
                    port,
                };
                characters::set_id(&config_dir(&app)?, &ch, &id)?;
                store.upsert(ch);
                Ok(())
            })?;
            refresh_character_menu(&app);
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

/// 登録したキャラで接続する。ID は .phirc から読み、UI には渡さない。
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
    let id = characters::get_id(&config_dir(&app)?, &ch)?;
    let (host, port) = (ch.host, ch.port);
    let view = *sessions.view.lock().unwrap();
    let no = sessions.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel(64);
    sessions.senders.lock().unwrap().insert(no, tx);
    let store = store_path(&app)?;
    let cleanup = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        session::run(Login { host, port, id, view }, rx, move |ev| {
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
        cleanup.state::<Sessions>().tasks.lock().unwrap().remove(&no);
    });
    sessions.tasks.lock().unwrap().insert(no, task);
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

/// 地図の窓に入るマス数(v6 の視界)を全部のセッションへ知らせる。各セッションが型に合わせて `#ex-map view=` を送る
#[tauri::command]
async fn set_map_view(width: u8, height: u8, sessions: State<'_, Sessions>) -> Result<(), String> {
    if ![width, height].iter().all(|v| (3..=99).contains(v) && v % 2 == 1) {
        return Err(format!("視界の大きさは 3〜99 の奇数にする({width}x{height})"));
    }
    *sessions.view.lock().unwrap() = Some((width, height));
    let txs: Vec<_> = sessions.senders.lock().unwrap().values().cloned().collect();
    for tx in txs {
        // 切れたセッションは送れないだけ
        let _ = tx.send(format!("{}{width} {height}", session::VIEW_PREFIX)).await;
    }
    Ok(())
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

/// 強制切断(Philly の ForceClose)。#x を送らずに接続を切る。サーバが応答しない時などに使う(#77)
#[tauri::command]
fn force_disconnect(session: u32, sessions: State<'_, Sessions>) {
    sessions.senders.lock().unwrap().remove(&session);
    if let Some(task) = sessions.tasks.lock().unwrap().remove(&session) {
        // タスクを止めると、接続(TcpStream)を捨てて閉じる
        task.abort();
    }
}

/// main 窓を最小化したら、見えている map 窓と EagleEye も最小化し、main 窓を戻したら一緒に戻す。
/// 戻すのは一緒に最小化した窓だけ(先に自分で最小化していた窓や、隠していた窓は戻さない)
fn follow_minimize(main: &tauri::Window) {
    static FOLLOWED: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let Ok(minimized) = main.is_minimized() else { return };
    let mut followed = FOLLOWED.lock().unwrap_or_else(|e| e.into_inner());
    if minimized && followed.is_empty() {
        for label in ["map", "eagleeye"] {
            let Some(w) = main.app_handle().get_webview_window(label) else {
                continue;
            };
            if w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(true) && w.minimize().is_ok() {
                followed.push(label.to_string());
            }
        }
    } else if !minimized && !followed.is_empty() {
        for label in followed.drain(..) {
            if let Some(w) = main.app_handle().get_webview_window(&label) {
                let _ = w.unminimize();
            }
        }
        // 戻した窓に入力を取られないよう、main 窓を前に戻す
        let _ = main.set_focus();
    }
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

/// 設定フォルダ(characters.json と settings.json の置き場)を開く
#[tauri::command]
async fn open_config_dir(app: tauri::AppHandle) -> Result<(), String> {
    open_dir(&app, config_dir(&app)?)
}

/// フォルダを OS のファイルマネージャで開く。無ければ作る
fn open_dir(app: &tauri::AppHandle, dir: std::path::PathBuf) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
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
/// メニューの項目を選んだ時(OS のメニューと、macOS の窓の中のメニュー)
fn select_menu(app: &tauri::AppHandle, id: &str) {
    use tauri::Emitter;
    if id == "exit" {
        exit_app(app);
        return;
    }
    if menu::experiment(&mut settings::Settings::default(), id).is_some()
        || menu::set_layout(&mut settings::Settings::default(), id)
    {
        let saved = settings_path(app).and_then(|p| {
            jsonfile::update(&p, |s: &mut settings::Settings| {
                if let Some(v) = menu::experiment(s, id) {
                    *v = !*v;
                }
                menu::set_layout(s, id);
                Ok(s.clone())
            })
        });
        match saved {
            Ok(s) => {
                if let Some(menu) = main_menu(app) {
                    menu::set_layout_checks(&menu, &s);
                }
                let _ = app.emit(menu::EXPERIMENT_EVENT, s);
            }
            Err(e) => eprintln!("設定を保存出来ません: {e}"),
        }
        return;
    }
    let _ = app.emit_to("main", menu::MENU_EVENT, id.to_string());
}

/// 超魔法メニューの MasterMagicMenu.xml(#83)。設定フォルダ → 取り込んだ Philly フォルダの Config の順に探す。
/// Philly のパーツなので同梱はしない
#[tauri::command]
fn master_magic_xml(app: tauri::AppHandle) -> Option<String> {
    let philly = Store::load(&store_path(&app).ok()?).philly_folder;
    [
        config_dir(&app).ok().map(|d| d.join("MasterMagicMenu.xml")),
        philly.map(|f| std::path::Path::new(&f).join("Config").join("MasterMagicMenu.xml")),
    ]
    .into_iter()
    .flatten()
    .find_map(|p| std::fs::read(p).ok())
    .map(|b| phi_proto::codec::decode(&b))
}

/// 超魔法メニューを OS のメニューに足すか外す(#83)。`menus` が None なら外す。
/// 項目の id は `mm:<メニューの番号>:<項目の番号>` で、選ぶと MENU_EVENT で UI へ送る
#[tauri::command]
fn set_master_menu(app: tauri::AppHandle, caption: String, menus: Option<Vec<menu::MasterMenu>>) -> Result<(), String> {
    let bar = main_menu(&app).ok_or("メニューがありません")?;
    menu::set_master_menu(&app, &bar, &caption, menus.as_deref()).map_err(|e| e.to_string())
}

/// macOS の窓の中のメニューで選んだ時。OS のメニューと同じに扱う
#[tauri::command]
fn menu_select(app: tauri::AppHandle, id: String) {
    select_menu(&app, &id);
}

/// macOS の窓の中に出すメニューの項目(OS のメニューと同じ物)
#[tauri::command]
fn menu_model(app: tauri::AppHandle) -> Vec<menu::MenuModel> {
    let mut model = menu::model();
    menu::add_characters(&mut model, &character_labels(&app));
    model
}

fn character_labels(app: &tauri::AppHandle) -> Vec<String> {
    store_path(app)
        .map(|p| Store::load(&p).characters.into_iter().map(|c| c.label).collect())
        .unwrap_or_default()
}

/// 登録したキャラが変わった時に、「キャラクター」のメニューを作り直す(#78)
fn refresh_character_menu(app: &tauri::AppHandle) {
    use tauri::Emitter;
    if let Some(bar) = main_menu(app) {
        let _ = menu::set_characters(app, &bar, &character_labels(app));
    }
    let _ = app.emit(menu::MENU_CHANGED_EVENT, ());
}

/// メニューバー。macOS はアプリのメニュー、他は main 窓のメニュー
fn main_menu(app: &tauri::AppHandle) -> Option<tauri::menu::Menu<tauri::Wry>> {
    #[cfg(target_os = "macos")]
    return app.menu();
    #[cfg(not(target_os = "macos"))]
    app.get_webview_window("main").and_then(|w| w.menu())
}

#[tauri::command]
fn set_view_checks(app: tauri::AppHandle, turn: bool) {
    if let Some(menu) = main_menu(&app) {
        menu::set_view_checks(&menu, turn);
    }
}

/// デバッグ表示を切り替える。切り替えた後の状態を返す
#[tauri::command]
fn toggle_debug() -> bool {
    session::set_debug(!session::debug_on());
    session::debug_on()
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

/// キャラのフォルダ(設定フォルダの `<表示名>.chara`。.phirc の置き場)を開く(Philly の OpenFolder。#82)
#[tauri::command]
async fn open_character_dir(app: tauri::AppHandle, label: String) -> Result<(), String> {
    open_dir(&app, config_dir(&app)?.join(format!("{}.chara", dir_name(&label))))
}

/// グラキャッシュ初期化(Philly の InitializeGraCache。#82)。画像を探し直し、map 窓と EagleEye に読み直させる。
/// 置いた画像は、起動し直さなくてもこれで使われる
#[tauri::command]
async fn reload_assets(app: tauri::AppHandle) -> Result<(), String> {
    reload_assets_now(&app)
}

/// 画像を読み直す。download_item からも呼ぶ
fn reload_assets_now(app: &tauri::AppHandle) -> Result<(), String> {
    let assets = app.state::<Mutex<Arc<Assets>>>();
    use tauri::Emitter;
    *assets.lock().unwrap() = Arc::new(load_assets(app)?);
    let _ = app.emit("phi-assets-reload", ());
    Ok(())
}

/// マップとイーグルアイの画像の保存(Philly の SSMap・SSEagleEye。#82)。ログのフォルダの SS に PNG で書く
#[tauri::command]
fn save_screenshot(app: tauri::AppHandle, label: String, kind: String, png: Vec<u8>) -> Result<String, String> {
    if !matches!(kind.as_str(), "map" | "eagleeye") || !png.starts_with(b"\x89PNG") {
        return Err("保存出来ない画像です".into());
    }
    let dir = logs::log_dir(&app, &label)?.join("SS");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let path = dir.join(format!("{kind}-{ms}.png"));
    std::fs::write(&path, png).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.display().to_string())
}

/// 安心ボタン(Philly の SafetyButton の表示位置の初期化。#82)。窓を既定の大きさに戻して画面の中央に置く。
/// 画面の外に出てしまった窓を戻す為
#[tauri::command]
fn reset_windows(app: tauri::AppHandle) {
    for (label, w, h) in [
        ("main", 800.0, 600.0),
        ("map", 437.0, 481.0),
        // v6 の 65x49 が 1マス 16px で収まる大きさ
        ("eagleeye", 1040.0, 784.0),
    ] {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.unmaximize();
            let _ = win.set_size(tauri::LogicalSize::new(w, h));
            let _ = win.center();
        }
    }
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
            migrate_config(app.handle());
            app.manage(Mutex::new(Arc::new(load_assets(app.handle())?)));
            app.manage(Mutex::new(Arc::new(load_sounds(app.handle()))));
            // メニューバーは main 窓だけに付ける
            let settings = settings_path(app.handle())
                .map(|p| settings::Settings::load(&p))
                .unwrap_or_default();
            let bar = menu::build(app.handle(), &settings)?;
            // macOS は窓ごとのメニューを出さないので、アプリのメニューにする(どの窓が前でも出る)
            #[cfg(target_os = "macos")]
            app.set_menu(bar)?;
            #[cfg(not(target_os = "macos"))]
            if let Some(main) = app.get_webview_window("main") {
                main.set_menu(bar)?;
            }
            refresh_character_menu(app.handle());
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                enable_ime_preedit(&window);
            }
            Ok(())
        })
        // main 窓を閉じたらアプリを終える。map と EagleEye は閉じても隠すだけなので、残ったままだとアプリが終わらず、
        // window-state が窓の位置を書き出す RunEvent::Exit も来ない(窓の位置が保存されなかった)
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                tauri::WindowEvent::Destroyed => exit_app(window.app_handle()),
                // 最小化と元に戻すは Resized で届く
                tauri::WindowEvent::Resized(_) => follow_minimize(window),
                _ => {}
            }
        })
        .on_menu_event(|app, event| select_menu(app, event.id().0.as_str()))
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
            register_worlds,
            download_items,
            download_item,
            get_settings,
            save_settings,
            import_philly_settings,
            register_character,
            connect,
            send_line,
            set_map_view,
            send_lines,
            logs::open_log_dir,
            open_config_dir,
            menu_select,
            menu_model,
            master_magic_xml,
            logs::save_log_buffer,
            open_character_dir,
            reload_assets,
            save_screenshot,
            reset_windows,
            set_master_menu,
            disconnect,
            force_disconnect,
            logs::log_css,
            logs::log_html,
            logs::append_log,
            set_trace,
            set_view_checks,
            trace_on,
            toggle_debug,
            trace
        ])
        .run(tauri::generate_context!())
        .expect("Tauri の起動に失敗した");
}
