//! 効果音(Philly の PersonalThread.cpp の SoundPlay)。
//!
//! Philly フォルダの `Config/SoundRegexp.ini`(1行目は説明、2行目からは `/正規表現/フラグ`)と
//! `Config/SoundFile.ini`(1行目は説明、2行目からは WAV のパス)を行の番号で対応させる。
//! 受信した行に最初に一致した規則の音を鳴らし、ファイルが空ならタスクバーを点滅させる。

use std::path::{Path, PathBuf};

use fancy_regex::Regex;
use phi_proto::codec;

pub struct Rule {
    re: Regex,
    /// None ならタスクバーの点滅
    file: Option<PathBuf>,
}

#[derive(Default)]
pub struct Sounds {
    rules: Vec<Rule>,
}

/// Philly の BREGEXP の `/パターン/フラグ` を fancy-regex に直す。対応するフラグは i・s・m・x。
fn perl_regex(s: &str) -> Option<Regex> {
    let body = s.trim().strip_prefix('/')?;
    let end = body.rfind('/')?;
    let (pattern, flags) = (&body[..end], &body[end + 1..]);
    let flags: String = flags.chars().filter(|c| "ismx".contains(*c)).collect();
    let pattern = if flags.is_empty() {
        pattern.to_string()
    } else {
        format!("(?{flags}){pattern}")
    };
    Regex::new(&pattern).ok()
}

impl Sounds {
    /// Philly フォルダから読む。読めない行や規則は飛ばす。
    pub fn load(philly: &Path) -> Sounds {
        let read = |name: &str| {
            std::fs::read(philly.join("Config").join(name))
                .map(|b| codec::decode(&b))
                .unwrap_or_default()
        };
        let regexps = read("SoundRegexp.ini");
        let files = read("SoundFile.ini");
        let files: Vec<&str> = files.lines().collect();
        let rules = regexps
            .lines()
            .enumerate()
            .skip(1)
            .filter_map(|(i, line)| {
                let re = perl_regex(line)?;
                let file = files.get(i).map(|f| f.trim()).filter(|f| !f.is_empty()).map(|f| {
                    // Philly の相対パスは Philly フォルダから。区切りは \
                    let rel = f.replace('\\', "/");
                    let p = PathBuf::from(&rel);
                    if p.is_absolute() { p } else { philly.join(rel) }
                });
                Some(Rule { re, file })
            })
            .collect();
        Sounds { rules }
    }

    /// 一致した規則の番号。
    pub fn find(&self, text: &str) -> Option<usize> {
        self.rules.iter().position(|r| r.re.is_match(text).unwrap_or(false))
    }

    /// 規則の番号の WAV。タスクバーの点滅の規則や、読めないファイルなら None。
    pub fn wav(&self, no: usize) -> Option<Vec<u8>> {
        std::fs::read(self.rules.get(no)?.file.as_ref()?).ok()
    }

    pub fn has_file(&self, no: usize) -> bool {
        self.rules.get(no).is_some_and(|r| r.file.is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn perl_regex_flags() {
        // i・s・m・x だけを fancy-regex のフラグにし、g などは捨てる
        assert!(perl_regex("/abc/ig").unwrap().is_match("ABC").unwrap());
        assert!(perl_regex("/a.b/s").unwrap().is_match("a\nb").unwrap());
        assert!(perl_regex("/^b/m").unwrap().is_match("a\nb").unwrap());
        assert!(!perl_regex("/^b/").unwrap().is_match("a\nb").unwrap());
        // / で囲んでいない行と、壊れた正規表現は規則にしない
        assert!(perl_regex("abc").is_none());
        assert!(perl_regex("/(/").is_none());
    }

    #[test]
    fn loads_philly_sound_config() {
        let root = std::env::temp_dir().join(format!("wphi-sound-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("Config")).unwrap();
        std::fs::create_dir_all(root.join("sound")).unwrap();
        std::fs::write(root.join("sound/a.wav"), b"RIFF").unwrap();
        std::fs::write(
            root.join("Config/SoundRegexp.ini"),
            codec::encode("説明\r\n/攻撃した/\r\n/PRIV/i\r\n/(壊れた/\r\n"),
        )
        .unwrap();
        std::fs::write(
            root.join("Config/SoundFile.ini"),
            codec::encode("説明\r\nsound\\a.wav\r\n\r\n"),
        )
        .unwrap();
        let s = Sounds::load(&root);
        assert_eq!(s.find("勇者が攻撃した"), Some(0));
        assert_eq!(s.wav(0).as_deref(), Some(&b"RIFF"[..]));
        // ファイルが空の規則はタスクバーの点滅
        assert_eq!(s.find("[x] > priv"), Some(1));
        assert!(!s.has_file(1));
        assert_eq!(s.find("何もない"), None);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
