//! 系統魔法の前に武器を外す(Philly の AutoUnequipSystemMagic。CharacterCommon.cpp の classAutoUnequip と
//! PersonalThread.cpp の受信の処理)。#4
//!
//! UI が `#wphi-cast <1|0> <唱える行をタブで繋いだもの>` を送ると、`unequip` だけを送って唱える行を覚える。
//! 届いた装備のリストは出さずに横取りし、1番が武器なら `1` を、防具か装身具なら `.` を送ってから唱える。
//! 何も装備していなければそのまま唱える。1 の時(AutoEquipSystemMagic)は、唱えた後に外した武器を装備し直す。

use std::time::{Duration, Instant};

/// UI から届く、系統魔法を唱える行の頭。サーバへは送らない
pub const CAST_PREFIX: &str = "#wphi-cast ";

/// 唱える魔法を覚えておく時間(Philly の AUTO_UNEQUIP__TIME)
const KEEP: Duration = Duration::from_secs(5);

#[derive(Default)]
pub struct AutoUnequip {
    cast: Vec<String>,
    reequip: bool,
    /// これより前なら、unequip の返事を待っている
    until: Option<Instant>,
    /// 横取りしている装備のリストの中
    list_on: bool,
    /// リストの後の「外す装備を選択して下さい」を出さない
    skip_prompt: bool,
    /// 装備し直した時の「を装備した」を出さない
    hide_equipped_until: Option<Instant>,
}

impl AutoUnequip {
    /// UI の `#wphi-cast` の行なら、覚えて先に送る `unequip` を返す
    pub fn start(&mut self, line: &str, now: Instant) -> Option<&'static str> {
        let rest = line.strip_prefix(CAST_PREFIX)?;
        let (flag, cast) = rest.split_once(' ').unwrap_or((rest, ""));
        self.cast = cast.split('\t').filter(|l| !l.is_empty()).map(String::from).collect();
        self.reequip = flag == "1";
        self.until = Some(now + KEEP);
        self.list_on = false;
        Some("unequip")
    }

    fn enabled(&self, now: Instant) -> bool {
        self.until.is_some_and(|u| now < u)
    }

    /// 横取りしているか。何もしていない時は、受信の行を文字にせずに済ませる
    pub fn active(&self, now: Instant) -> bool {
        self.enabled(now) || self.list_on || self.skip_prompt || self.hide_equipped_until.is_some_and(|u| now < u)
    }

    /// 受けた行(タグを除いた文字)。出さない行なら true。送る行は `reply` に足す
    pub fn filter(&mut self, text: &str, now: Instant, reply: &mut Vec<String>) -> bool {
        if self.skip_prompt {
            self.skip_prompt = false;
            if text.contains("外す装備を選択して下さい") || text.contains("Input item number to unequip.") {
                return true;
            }
        }
        if self.enabled(now) && !self.list_on {
            if text == "#list" {
                self.list_on = true;
                return true;
            }
            if ["装備を外せません", "なにも装備していません", "Can not unequip."]
                .iter()
                .any(|s| text.contains(s))
            {
                self.cast_now(None, reply);
                return true;
            }
        }
        if self.list_on {
            if text == "#end-list" {
                self.list_on = false;
                self.skip_prompt = true;
                // 1番を読めなかった時も、選ぶのを取り消して唱える。待ったままだと、5秒の間に届く次のリスト
                // (アイテムを拾う時など)まで横取りしてしまう
                if self.enabled(now) {
                    self.cast_now(Some("."), reply);
                }
            } else if self.enabled(now)
                && let Some((name, kind)) = first_equipment(text)
            {
                if kind == "Wpn" {
                    if self.reequip {
                        self.hide_equipped_until = Some(now + KEEP);
                    }
                    let equip = self.reequip.then(|| format!("equip {name}"));
                    self.cast_now(Some("1"), reply);
                    reply.extend(equip);
                } else {
                    self.cast_now(Some("."), reply);
                }
            }
            return true;
        }
        if self.hide_equipped_until.is_some_and(|u| now < u) && text.contains("を装備した") {
            self.hide_equipped_until = None;
            return true;
        }
        false
    }

    fn cast_now(&mut self, answer: Option<&str>, reply: &mut Vec<String>) {
        reply.extend(answer.map(String::from));
        reply.append(&mut self.cast);
        self.until = None;
    }
}

/// 装備のリストの1番。名前と、Wpn・Arm・Acr のどれか(Philly の `\[ 1\] (.{0,32})Wp.*?\[(Wpn|Arm|Acr)\]`)。
/// v5y の行は `     [/*color=cyan*/ 1/*.*/] 名前<空白> Wp  :  5 [/*color=red*/Wpn/*.*/] ` で、行頭に空白が付く
/// (phi_dm/input.rs の itemlist)。タグを除いた行の途中から探す
fn first_equipment(text: &str) -> Option<(&str, &str)> {
    let rest = &text[text.find("[ 1] ")? + 5..];
    // v5y は「Wp  : 5」と書く。名前に Wp を含んでも、この欄を使う。無ければ Philly と同じく最初の Wp
    let wp = rest.rfind("Wp  :").or_else(|| rest.find("Wp"))?;
    let kind = ["Wpn", "Arm", "Acr"]
        .into_iter()
        .find(|k| rest[wp..].contains(&format!("[{k}]")))?;
    Some((rest[..wp].trim(), kind))
}

/// `/*...*/` のタグを除く(Philly の TagDeletedText)
pub fn strip_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("/*") {
        out.push_str(&rest[..i]);
        match rest[i + 2..].find("*/") {
            Some(j) => rest = &rest[i + 2 + j + 2..],
            None => {
                rest = &rest[i..];
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(a: &mut AutoUnequip, lines: &[&str], now: Instant) -> (Vec<String>, Vec<String>) {
        let mut reply = Vec::new();
        let shown = lines
            .iter()
            .filter(|l| !a.filter(&strip_tags(l), now, &mut reply))
            .map(|l| l.to_string())
            .collect();
        (reply, shown)
    }

    #[test]
    fn unequips_weapon_then_casts_and_reequips() {
        let now = Instant::now();
        let mut a = AutoUnequip::default();
        assert_eq!(a.start("#wphi-cast 1 cast\twizard eye", now), Some("unequip"));
        let (reply, shown) = run(
            &mut a,
            &[
                "#list",
                // v5y の itemlist の行
                "     [/*color=cyan*/ 1/*.*/] ロングソード                    Wp  :  5 [/*color=red*/Wpn/*.*/] ",
                "     [/*color=cyan*/ 2/*.*/] 革の鎧                          Wp  :  2 [/*color=+hp*/Arm/*.*/] ",
                "#end-list",
                "外す装備を選択して下さい",
                "ロングソードを装備した",
                "こんにちは",
            ],
            now,
        );
        assert_eq!(reply, ["1", "cast", "wizard eye", "equip ロングソード"]);
        assert_eq!(shown, ["こんにちは"]);
    }

    #[test]
    fn armor_first_or_nothing_equipped() {
        let now = Instant::now();
        let mut a = AutoUnequip::default();
        a.start("#wphi-cast 0 cast\tdetect", now);
        let (reply, _) = run(
            &mut a,
            &[
                "#list",
                "     [/*color=cyan*/ 1/*.*/] 革の鎧   Wp  :  2 [/*color=+hp*/Arm/*.*/] ",
                "#end-list",
            ],
            now,
        );
        assert_eq!(reply, [".", "cast", "detect"]);

        a.start("#wphi-cast 1 cast\tcall", now);
        let (reply, shown) = run(&mut a, &["なにも装備していません", "#list", "[ 1] 何か"], now);
        assert_eq!(reply, ["cast", "call"]);
        // 唱えた後に届くリスト(魔法の対象など)は横取りしない
        assert_eq!(shown, ["#list", "[ 1] 何か"]);
    }

    #[test]
    fn unknown_list_still_casts_and_frees_next_list() {
        let now = Instant::now();
        let mut a = AutoUnequip::default();
        a.start("#wphi-cast 1 cast\twizard eye", now);
        let (reply, shown) = run(
            &mut a,
            &[
                "#list",
                "読めない行",
                "#end-list",
                "外す装備を選択して下さい",
                "#list",
                "[ 1] Nuts",
                "#end-list",
            ],
            now,
        );
        assert_eq!(reply, [".", "cast", "wizard eye"]);
        assert_eq!(shown, ["#list", "[ 1] Nuts", "#end-list"]);
    }

    #[test]
    fn forgets_after_five_seconds() {
        let now = Instant::now();
        let mut a = AutoUnequip::default();
        a.start("#wphi-cast 1 cast\tlist", now);
        let later = now + Duration::from_secs(6);
        assert!(!a.active(later));
        let (reply, shown) = run(&mut a, &["#list", "[ 1] 剣 Wp1 [Wpn]"], later);
        assert!(reply.is_empty());
        assert_eq!(shown.len(), 2);
    }

    #[test]
    fn other_lines_are_not_casts() {
        assert_eq!(AutoUnequip::default().start("say hi", Instant::now()), None);
        assert_eq!(strip_tags("a/*cl=red*/b/*.*/c/*x"), "abc/*x");
    }
}
