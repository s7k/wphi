//! 設定(Philly の Philly.ini に当たる)。設定フォルダの `settings.json` に置く。
//! 既定値は Philly の既定値。ただしフルキー移動だけは作者が使うので on にしてある。

use std::path::Path;

use phi_proto::codec;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// フルキーの 789 uio jkl m をテンキーとして使う([Move] FullKeyMove)
    pub full_key_move: bool,
    /// 移動キーを押してからリピートに入るまで(ms、[Move] RepeatModeStartTime)
    pub repeat_start_ms: u32,
    /// 移動キーを離してからリピートを終えるまで(ms、[Move] RepeatModeEndTime)
    pub repeat_end_ms: u32,
    /// F8〜F12 で送る文字列。`\n` は改行([Shortcut] ShortcutF08〜F12)
    pub shortcuts: [String; 5],
    /// リスト表示中の F8〜F12([Shortcut] ListModeShortcutF08〜F12)
    pub list_shortcuts: [String; 5],
    /// Alt+G で送る言葉([Shortcut] AltGWord)
    pub alt_g_word: String,
    /// ログに出てきた文字列で効果音を鳴らす([Sound] SoundPlay)
    pub sound_play: bool,
    /// ログを HTML で保存する。off ならテキスト([Log] LogSaveHtml)
    pub log_save_html: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            full_key_move: true,
            repeat_start_ms: 200,
            repeat_end_ms: 100,
            shortcuts: Default::default(),
            list_shortcuts: Default::default(),
            alt_g_word: String::new(),
            sound_play: true,
            log_save_html: true,
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Settings {
        crate::jsonfile::load(path)
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        crate::jsonfile::save(path, self)
    }

    /// Philly.ini(cp932)の対応する項目を取り込む。無い項目は今の値のまま。
    pub fn import_philly_ini(&mut self, bytes: &[u8]) {
        let ini = parse_ini(&codec::decode(bytes));
        let get = |section: &str, key: &str| ini.iter().find(|(s, k, _)| s == section && k == key).map(|(_, _, v)| v);
        let on = |v: &String| v.eq_ignore_ascii_case("on") || v == "1" || v.eq_ignore_ascii_case("true");
        if let Some(v) = get("Move", "FullKeyMove") {
            self.full_key_move = on(v);
        }
        if let Some(v) = get("Move", "RepeatModeStartTime").and_then(|v| v.parse().ok()) {
            self.repeat_start_ms = v;
        }
        if let Some(v) = get("Move", "RepeatModeEndTime").and_then(|v| v.parse().ok()) {
            self.repeat_end_ms = v;
        }
        for (i, f) in ["F08", "F09", "F10", "F11", "F12"].iter().enumerate() {
            if let Some(v) = get("Shortcut", &format!("Shortcut{f}")) {
                self.shortcuts[i] = v.clone();
            }
            if let Some(v) = get("Shortcut", &format!("ListModeShortcut{f}")) {
                self.list_shortcuts[i] = v.clone();
            }
        }
        if let Some(v) = get("Shortcut", "AltGWord") {
            self.alt_g_word = v.clone();
        }
        if let Some(v) = get("Log", "LogSaveHtml") {
            self.log_save_html = on(v);
        }
        if let Some(v) = get("Sound", "SoundPlay") {
            self.sound_play = on(v);
        }
    }
}

/// `[節]` と `キー=値 ; コメント` を読む。値が "" で囲まれていれば中身をそのまま使う。
fn parse_ini(text: &str) -> Vec<(String, String, String)> {
    let mut section = String::new();
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if let Some(s) = line.strip_prefix('[').and_then(|l| l.split_once(']')) {
            section = s.0.trim().to_string();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim_start();
        let value = match value.strip_prefix('"').and_then(|v| v.split_once('"')) {
            Some((quoted, _)) => quoted.to_string(),
            None => value.split(';').next().unwrap_or("").trim().to_string(),
        };
        out.push((section.clone(), key.trim().to_string(), value));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ini_edge_cases() {
        let ini = parse_ini("a=0\n[S]\nk = \"x;y\" ; c\nnoequal\nq=\"open\nv = 1 ; c\n");
        assert_eq!(
            ini,
            vec![
                // 節の前の行は節の名前が空
                ("".into(), "a".into(), "0".into()),
                // " で囲んだ値の中の ; は注釈にしない
                ("S".into(), "k".into(), "x;y".into()),
                // 閉じていない " はそのまま値にする
                ("S".into(), "q".into(), "\"open".into()),
                ("S".into(), "v".into(), "1".into()),
            ]
        );
    }

    #[test]
    fn imports_philly_ini() {
        let ini = codec::encode(
            "[Move]\r\nFullKeyMove=off                         ; フルキー\r\nRepeatModeStartTime=300 ; ms\r\n\
             [Shortcut]\r\nShortcutF10=\"1\"   ; ショートカット\r\nListModeShortcutF09=\"1 2\" ; リスト\r\n\
             AltGWord=\"おやすみなさいませ\"           ; Alt + G\r\n[Other]\r\nFullKeyMove=on\r\n",
        );
        let mut s = Settings::default();
        s.import_philly_ini(&ini);
        assert!(!s.full_key_move);
        assert_eq!(s.repeat_start_ms, 300);
        assert_eq!(s.repeat_end_ms, 100);
        assert_eq!(s.shortcuts[2], "1");
        assert_eq!(s.list_shortcuts[1], "1 2");
        assert_eq!(s.alt_g_word, "おやすみなさいませ");
    }
}
