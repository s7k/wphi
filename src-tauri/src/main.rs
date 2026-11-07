#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets;
mod characters;
mod session;

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
    let path = store_path(&app)?;
    let mut store = Store::load(&path);
    if !id.is_empty() {
        characters::set_id(&character.label, &id)?;
    }
    store.upsert(character);
    store.save(&path)
}

#[tauri::command]
fn delete_character(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let path = store_path(&app)?;
    let mut store = Store::load(&path);
    store.characters.retain(|c| c.label != label);
    store.open_tabs.retain(|l| *l != label);
    characters::delete_id(&label);
    store.save(&path)
}

#[tauri::command]
fn set_open_tabs(app: tauri::AppHandle, labels: Vec<String>) -> Result<(), String> {
    let path = store_path(&app)?;
    let mut store = Store::load(&path);
    store.open_tabs = labels;
    store.save(&path)
}

/// 画像を探す場所。取り込んだ Philly フォルダ → 同梱の `resources/phi` の順。
fn load_assets(app: &tauri::AppHandle) -> Result<Assets, String> {
    let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join("phi");
    let store = Store::load(&store_path(app)?);
    Ok(Assets::new(
        store
            .philly_folder
            .map(Into::into)
            .into_iter()
            .chain([bundled])
            .collect(),
    ))
}

/// Philly フォルダの `*.chara/.phirc` を登録する。登録した表示名を返す。
/// フォルダは覚えておき、以後の画像もここから先に探す。
#[tauri::command]
fn import_philly(
    app: tauri::AppHandle,
    folder: String,
    assets: State<'_, Mutex<Arc<Assets>>>,
) -> Result<Vec<String>, String> {
    let path = store_path(&app)?;
    let mut store = Store::load(&path);
    store.philly_folder = Some(folder.clone());
    let mut labels = Vec::new();
    for p in characters::read_philly(std::path::Path::new(&folder))? {
        characters::set_id(&p.character.label, &p.id)?;
        labels.push(p.character.label.clone());
        store.upsert(p.character);
    }
    store.save(&path)?;
    *assets.lock().unwrap() = Arc::new(load_assets(&app)?);
    Ok(labels)
}

/// `phi-asset://localhost/<種類>?...` に PNG を返す。種類は chara・chip・items。
fn asset_response(app: &tauri::AppHandle, uri: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    let Ok(url) = tauri::Url::parse(uri) else {
        return not_found();
    };
    let kind = url.path().trim_start_matches('/').to_string();
    let query = url.query_pairs().into_owned().collect();
    let assets = app.state::<Mutex<Arc<Assets>>>().lock().unwrap().clone();
    match assets.get(&kind, &query) {
        Some(png) => tauri::http::Response::builder()
            .header("Content-Type", "image/png")
            .body(png)
            .unwrap(),
        None => not_found(),
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
    tauri::async_runtime::spawn(session::run(Login { host, port, id }, rx, move |ev| {
        // 世界移動したら、登録したキャラの接続先を書き換える(Philly の RewriteSaveData)
        if let UiEvent::Ui(session::UiOnly::WorldMoved { host, port }) = &ev {
            let mut s = Store::load(&store);
            if let Some(c) = s.characters.iter_mut().find(|c| c.label == label) {
                c.host = host.clone();
                c.port = *port;
            }
            if let Err(e) = s.save(&store) {
                eprintln!("接続先を保存出来ません: {e}");
            }
        }
        // UI の窓が閉じていれば送れないだけなので、失敗は無視する
        let _ = on_event.send(ev);
    }));
    Ok(no)
}

#[tauri::command]
async fn send_line(session: u32, text: String, sessions: State<'_, Sessions>) -> Result<(), String> {
    let tx = sessions.senders.lock().unwrap().get(&session).cloned();
    let tx = tx.ok_or("接続していません")?;
    tx.send(text).await.map_err(|_| "接続が切れています".to_string())
}

#[tauri::command]
fn disconnect(session: u32, sessions: State<'_, Sessions>) {
    // 送信キューを閉じると、接続のタスクが #x を送って終わる
    sessions.senders.lock().unwrap().remove(&session);
}

/// スキンのログ用スタイルシート(Philly の `Skins/<スキン>/Style/Log.css`)。
#[tauri::command]
fn log_css(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("phi/Skins/Mine/Style/Log.css");
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
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
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                enable_ime_preedit(&window);
            }
            Ok(())
        })
        .register_uri_scheme_protocol("phi-asset", |ctx, req| {
            asset_response(ctx.app_handle(), &req.uri().to_string())
        })
        .plugin(tauri_plugin_opener::init())
        .manage(Sessions::default())
        .invoke_handler(tauri::generate_handler![
            list_characters,
            save_character,
            delete_character,
            set_open_tabs,
            import_philly,
            connect,
            send_line,
            disconnect,
            log_css
        ])
        .run(tauri::generate_context!())
        .expect("Tauri の起動に失敗した");
}
