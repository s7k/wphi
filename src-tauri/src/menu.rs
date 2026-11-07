//! main 窓のメニューバー(Philly の MainForm.dfm の MainMenu)。
//!
//! 項目を選ぶと、項目の id を MENU_EVENT で main 窓へ送り、UI が操作にする。
//! キーの操作は UI が持っているので、メニューにはショートカットキーを付けない(二重に送らない為)。
//! スキンの `Style/Menu.txt` で `off` にしたメニューは出さない(Philly と同じく起動時にだけ読む)。

use tauri::{
    AppHandle, Runtime,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
};

pub const MENU_EVENT: &str = "phi-menu";

/// (メニュー名, 項目)。項目の id が "-" なら区切り線。
type Table = &'static [(&'static str, &'static [(&'static str, &'static str)])];

const MENUS: Table = &[
    (
        "ファイル",
        &[("settings", "設定(&S)..."), ("-", ""), ("exit", "終了(&X)")],
    ),
    ("操作", &[("priv", "priv")]),
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
            ("wizard-eye", "Wizard eye"),
            ("wizard-light", "Wizard light"),
            ("list", "List"),
            ("eagle-eye", "Eagle eye"),
            ("identify", "Identify"),
            ("-", ""),
            ("wizard-lock", "Wizard lock"),
            ("unlock", "Unlock"),
            ("-", ""),
            ("detect", "Detect..."),
            ("create", "Create..."),
            ("destroy", "Destroy..."),
            ("-", ""),
            ("analyze", "Analyze..."),
            ("forget", "Forget..."),
            ("-", ""),
            ("call", "Call"),
            ("return", "Return"),
        ],
    ),
    ("表示", &[("map", "マップ")]),
];

/// `Menu.txt` の `off,<メニュー名>` の行。
fn hidden_menus(menu_txt: &str) -> Vec<String> {
    menu_txt
        .lines()
        .filter_map(|l| l.trim().strip_prefix("off,"))
        .map(|name| name.split('(').next().unwrap_or(name).trim().to_string())
        .collect()
}

pub fn build<R: Runtime>(app: &AppHandle<R>, menu_txt: &str) -> tauri::Result<Menu<R>> {
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
