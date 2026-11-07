#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod session;

use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicU32, Ordering},
    },
};

use session::{Login, UiEvent};
use tauri::{Manager, State, ipc::Channel};
use tokio::sync::mpsc;

/// 接続中のキャラ。番号 → 送信キュー。
#[derive(Default)]
struct Sessions {
    next: AtomicU32,
    senders: Mutex<HashMap<u32, mpsc::Sender<String>>>,
}

#[tauri::command]
fn connect(host: String, port: u16, id: String, on_event: Channel<UiEvent>, sessions: State<'_, Sessions>) -> u32 {
    let no = sessions.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel(64);
    sessions.senders.lock().unwrap().insert(no, tx);
    tauri::async_runtime::spawn(session::run(Login { host, port, id }, rx, move |ev| {
        // UI の窓が閉じていれば送れないだけなので、失敗は無視する
        let _ = on_event.send(ev);
    }));
    no
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

fn main() {
    #[cfg(target_os = "linux")]
    prefer_x11_ime();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Sessions::default())
        .invoke_handler(tauri::generate_handler![connect, send_line, disconnect, log_css])
        .run(tauri::generate_context!())
        .expect("Tauri の起動に失敗した");
}
