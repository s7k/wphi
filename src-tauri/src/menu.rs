//! main 窓のメニューバー(Philly の MainForm.dfm の MainMenu)。
//!
//! 項目を選ぶと、項目の id を MENU_EVENT で main 窓へ送り、UI が操作にする。
//! キーの操作は UI が持っているので、メニューにはショートカットキーを登録しない(二重に送らない為)。
//! 代わりに Philly と同じく、項目名にキーを書き添える。
//! スキンの `Style/Menu.txt` で `off` にしたメニューは出さない(Philly と同じく起動時にだけ読む)。

use tauri::{
    AppHandle, Runtime,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
};

pub const MENU_EVENT: &str = "phi-menu";
/// 設定を切り替える、チェックの付く項目。main.rs が設定に書き、EXPERIMENT_EVENT で設定の全体を全部の窓へ知らせる
pub const SMOOTH_MOVE: &str = "smooth-move";
pub const AUTOMAP: &str = "automap";
pub const EXPERIMENT_EVENT: &str = "phi-experiment";

/// 切り替える項目の、設定の値
pub fn experiment<'a>(s: &'a mut crate::settings::Settings, id: &str) -> Option<&'a mut bool> {
    match id {
        SMOOTH_MOVE => Some(&mut s.smooth_move),
        AUTOMAP => Some(&mut s.automap),
        _ => None,
    }
}
/// 今の表示のモードにチェックを付ける項目。モードはサーバが決めるので、UI が地図を受けるたびに set_view_checks で付け直す
const VIEW_CHECKS: [&str; 4] = ["map-turn", "map-solid", "map-57", "map-40"];

/// (メニュー名, 項目)。項目の id が "-" なら区切り線。
type Table = &'static [(&'static str, &'static [(&'static str, &'static str)])];

const MENUS: Table = &[
    (
        "ファイル",
        &[("settings", "設定(&S)..."), ("-", ""), ("exit", "終了(&X)")],
    ),
    (
        "キャラクター",
        &[
            ("next-tab", "次のタブ (Ctrl+Tab)"),
            ("new-tab", "キャラを選ぶ(新しいタブ)"),
        ],
    ),
    (
        "操作",
        &[
            ("priv", "priv"),
            ("loud", "大声"),
            ("all-tab", "全タブ発言"),
            ("-", ""),
            ("log-save", "ログ保存"),
            ("log-follow", "ログを固定"),
            ("open-log-dir", "ログの保存先を開く"),
        ],
    ),
    (
        "行動",
        &[
            ("get", "アイテムを拾う(&Z,+)..."),
            ("put", "アイテムを置く(&X,-)..."),
            ("use", "アイテムを使う(&C,*)..."),
            ("sort", "アイテム整理(&V)..."),
            ("floor", "アイテムに注意する(&F)"),
            ("-", ""),
            ("read", "看板を読む(&A)..."),
            ("write", "看板を書く(&S)..."),
            ("erase", "看板を消す(&D)..."),
            ("board", "看板に注意する(&B)"),
            ("-", ""),
            ("pay", "お金を払う(&P)"),
            ("spells", "魔法一覧(&R)"),
            ("-", ""),
            ("equip", "自動装備(&Q,/)"),
            ("unequip", "装備を外す(&W)..."),
            ("-", ""),
            ("check", "ステータスを見る (&M,0)"),
            ("skills", "スキルを見る"),
        ],
    ),
    (
        "魔法",
        &[
            ("wizard-eye", "Wizard eye (Alt+W)"),
            ("wizard-light", "Wizard light (Shift+Alt+W)"),
            ("list", "List (Shift+Alt+L)"),
            ("eagle-eye", "Eagle eye (Alt+E)"),
            ("identify", "Identify (Alt+I)"),
            ("search", "Search... (Alt+S)"),
            ("-", ""),
            ("wizard-lock", "Wizard lock (Alt+L)"),
            ("unlock", "Unlock (Alt+U)"),
            ("-", ""),
            ("detect", "Detect... (Alt+D)"),
            ("create", "Create... (Alt+C)"),
            ("destroy", "Destroy... (Shift+Alt+D)"),
            ("-", ""),
            ("analyze", "Analyze... (Alt+A)"),
            ("forget", "Forget... (Alt+F)"),
            ("charge-spell", "Charge spell... (Shift+Alt+C)"),
            ("-", ""),
            ("appear", "Appear... (Shift+Alt+A)"),
            ("disappear", "Disappear... (Shift+Alt+U)"),
            ("-", ""),
            ("call", "Call (Alt+B)"),
            ("return", "Return (Alt+R)"),
        ],
    ),
    (
        "表示",
        &[
            ("map", "マップ (Shift+F5)"),
            ("-", ""),
            ("map-turn", "回転マップ (T)"),
            ("map-solid", "北固定マップ (Shift+T)"),
            ("-", ""),
            ("map-57", "7x7 マップ (Shift+7)"),
            ("map-40", "5x5 マップ (Shift+5)"),
            ("-", ""),
            (AUTOMAP, "拡張マップ(位置の予想と長押しの制御付き)"),
            ("automap-clear", "この世界の拡張マップを消す"),
            ("-", ""),
            (SMOOTH_MOVE, "滑らかに動かす(実験的)"),
        ],
    ),
    (
        "ツール",
        &[
            ("open-config-dir", "設定フォルダを開く"),
            ("trace", "時刻の記録を始める・止める"),
            ("-", ""),
            ("version", "バージョン情報"),
        ],
    ),
];

/// 表示のモードのチェックを付け直す。turn は回転マップ、size57 は 7x7
pub fn set_view_checks<R: Runtime>(menu: &Menu<R>, turn: bool, size57: bool) {
    let want = [
        ("map-turn", turn),
        ("map-solid", !turn),
        ("map-57", size57),
        ("map-40", !size57),
    ];
    for item in menu.items().unwrap_or_default() {
        let Some(sub) = item.as_submenu() else { continue };
        for (id, on) in want {
            if let Some(c) = sub.get(id).as_ref().and_then(|i| i.as_check_menuitem()) {
                let _ = c.set_checked(on);
            }
        }
    }
}

/// `Menu.txt` の `off,<メニュー名>` の行。
fn hidden_menus(menu_txt: &str) -> Vec<String> {
    menu_txt
        .lines()
        .filter_map(|l| l.trim().strip_prefix("off,"))
        .map(|name| name.split('(').next().unwrap_or(name).trim().to_string())
        .collect()
}

/// 超魔法メニューのサブメニュー。items の "-" は区切り線
#[derive(serde::Deserialize)]
pub struct MasterMenu {
    pub caption: String,
    pub items: Vec<String>,
}

const MASTER_ID: &str = "master-magic";

/// 超魔法メニューを、メニューバーの最後に足し直す。None なら外すだけ
pub fn set_master_menu<R: Runtime>(
    app: &AppHandle<R>,
    bar: &Menu<R>,
    caption: &str,
    menus: Option<&[MasterMenu]>,
) -> tauri::Result<()> {
    if let Some(old) = bar.get(MASTER_ID) {
        bar.remove(&old)?;
    }
    let Some(menus) = menus else { return Ok(()) };
    let top = Submenu::with_id(app, MASTER_ID, caption, true)?;
    for (i, m) in menus.iter().enumerate() {
        let sub = Submenu::new(app, &m.caption, true)?;
        for (j, text) in m.items.iter().enumerate() {
            if text == "-" {
                sub.append(&PredefinedMenuItem::separator(app)?)?;
            } else {
                sub.append(&MenuItem::with_id(
                    app,
                    format!("mm:{i}:{j}"),
                    text,
                    true,
                    None::<&str>,
                )?)?;
            }
        }
        top.append(&sub)?;
    }
    bar.append(&top)
}

/// 窓の中に描くメニューの項目。id が "-" なら区切り線。check はチェックの付く項目
#[derive(serde::Serialize)]
pub struct MenuModel {
    pub name: &'static str,
    pub items: Vec<MenuItemModel>,
}

#[derive(serde::Serialize)]
pub struct MenuItemModel {
    pub id: &'static str,
    pub text: &'static str,
    pub check: bool,
}

pub fn model(menu_txt: &str) -> Vec<MenuModel> {
    let hidden = hidden_menus(menu_txt);
    MENUS
        .iter()
        .filter(|(name, _)| !hidden.iter().any(|h| h == name))
        .map(|(name, items)| MenuModel {
            name,
            items: items
                .iter()
                .map(|(id, text)| MenuItemModel {
                    id,
                    text,
                    check: experiment(&mut crate::settings::Settings::default(), id).is_some()
                        || VIEW_CHECKS.contains(id),
                })
                .collect(),
        })
        .collect()
}

pub fn build<R: Runtime>(
    app: &AppHandle<R>,
    menu_txt: &str,
    settings: &crate::settings::Settings,
) -> tauri::Result<Menu<R>> {
    let mut settings = settings.clone();
    let hidden = hidden_menus(menu_txt);
    let menu = Menu::new(app)?;
    // macOS は窓ごとのメニューを出さず、画面の上のアプリのメニューを使う。先頭の項目はアプリ名の項目になるので、
    // アプリ名の項目を先に置く。編集の項目が無いと、入力欄で Cmd+C・Cmd+V が効かない
    #[cfg(target_os = "macos")]
    {
        menu.append(&Submenu::with_items(
            app,
            "WPHI",
            true,
            &[
                // 中身を渡さないと、macOS は空の「このアプリについて」を出す
                &PredefinedMenuItem::about(
                    app,
                    Some("WPHI について"),
                    Some(tauri::menu::AboutMetadata {
                        name: Some("WPHI".into()),
                        version: Some(app.package_info().version.to_string()),
                        comments: Some("PHI のクライアント(Philly の後継)".into()),
                        website: Some("https://github.com/s7k/wphi".into()),
                        website_label: Some("github.com/s7k/wphi".into()),
                        license: Some("MIT".into()),
                        icon: app.default_window_icon().cloned(),
                        ..Default::default()
                    }),
                )?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "exit", "WPHI を終了", true, Some("Cmd+Q"))?,
            ],
        )?)?;
        menu.append(&Submenu::with_items(
            app,
            "編集",
            true,
            &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ],
        )?)?;
    }
    for (name, items) in MENUS {
        if hidden.iter().any(|h| h == name) {
            continue;
        }
        let sub = Submenu::new(app, *name, true)?;
        for (id, text) in *items {
            if *id == "-" {
                sub.append(&PredefinedMenuItem::separator(app)?)?;
            } else if experiment(&mut settings, id).is_some() || VIEW_CHECKS.contains(id) {
                let checked = experiment(&mut settings, id).is_some_and(|v| *v);
                sub.append(&CheckMenuItem::with_id(app, *id, *text, true, checked, None::<&str>)?)?;
            } else {
                sub.append(&MenuItem::with_id(app, *id, *text, true, None::<&str>)?)?;
            }
        }
        menu.append(&sub)?;
    }
    Ok(menu)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_hides_menus_and_marks_checks() {
        let m = model("off,魔法\r\n");
        assert!(!m.iter().any(|s| s.name == "魔法"));
        let view = m.iter().find(|s| s.name == "表示").unwrap();
        let check = |id: &str| view.items.iter().find(|i| i.id == id).unwrap().check;
        assert!(check("map-turn") && check(AUTOMAP) && check(SMOOTH_MOVE));
        assert!(!check("map"));
    }

    #[test]
    fn reads_menu_txt() {
        let txt = "メニュー項目\r\non,ファイル\r\noff,魔法\r\noff,ツール(&Y)\r\non,\r\n";
        assert_eq!(hidden_menus(txt), ["魔法", "ツール"]);
    }
}
