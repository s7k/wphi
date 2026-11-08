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
/// 実験的な機能の切り替え(チェックの付く項目)。main.rs が設定に書き、EXPERIMENT_EVENT で設定の全体を全部の窓へ知らせる
pub const SMOOTH_MOVE: &str = "smooth-move";
pub const PREDICT_MOVE: &str = "predict-move";
pub const EXPERIMENT_EVENT: &str = "phi-experiment";

/// 実験的な機能の項目の、設定の値
pub fn experiment<'a>(s: &'a mut crate::settings::Settings, id: &str) -> Option<&'a mut bool> {
    match id {
        SMOOTH_MOVE => Some(&mut s.smooth_move),
        PREDICT_MOVE => Some(&mut s.predict_move),
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
            ("automap-clear", "この世界の拡張マップを消す"),
            ("-", ""),
            (SMOOTH_MOVE, "滑らかに動かす(実験的)"),
            (PREDICT_MOVE, "地図が来ない時に位置を予想する(実験的)"),
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

pub fn build<R: Runtime>(
    app: &AppHandle<R>,
    menu_txt: &str,
    settings: &crate::settings::Settings,
) -> tauri::Result<Menu<R>> {
    let mut settings = settings.clone();
    let hidden = hidden_menus(menu_txt);
    let menu = Menu::new(app)?;
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
    fn reads_menu_txt() {
        let txt = "メニュー項目\r\non,ファイル\r\noff,魔法\r\noff,ツール(&Y)\r\non,\r\n";
        assert_eq!(hidden_menus(txt), ["魔法", "ツール"]);
    }
}
