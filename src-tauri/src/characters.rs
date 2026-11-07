//! 登録したキャラの一覧と、開いていたタブの保存。
//!
//! キャラ ID はログインの認証情報そのものなので、OS のキーチェーンに置き、UI には返さない。
//! 一覧(表示名・接続先)と開いていたタブは、設定フォルダの `characters.json` に置く。

use std::path::{Path, PathBuf};

use phi_proto::codec;
use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "rust-philly";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Character {
    /// タブに出す表示名。キーチェーンのキーも兼ねるので一覧の中で重ならない。
    pub label: String,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub characters: Vec<Character>,
    /// 終了時に開いていたタブの表示名(Philly の TabSession.ini)。
    pub open_tabs: Vec<String>,
    /// 取り込んだ Philly フォルダ。画像もここから先に探す。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub philly_folder: Option<String>,
}

impl Store {
    pub fn load(path: &Path) -> Store {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| format!("{}: {e}", path.display()))
    }

    pub fn find(&self, label: &str) -> Option<&Character> {
        self.characters.iter().find(|c| c.label == label)
    }

    /// 同じ表示名があれば置き換える。
    pub fn upsert(&mut self, ch: Character) {
        match self.characters.iter_mut().find(|c| c.label == ch.label) {
            Some(c) => *c = ch,
            None => self.characters.push(ch),
        }
    }
}

fn entry(label: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, label).map_err(|e| e.to_string())
}

pub fn set_id(label: &str, id: &str) -> Result<(), String> {
    entry(label)?
        .set_password(id)
        .map_err(|e| format!("キーチェーンに保存出来ません: {e}"))
}

pub fn get_id(label: &str) -> Result<String, String> {
    entry(label)?
        .get_password()
        .map_err(|e| format!("キーチェーンから読めません: {e}"))
}

pub fn delete_id(label: &str) {
    // 元から無い時も一覧からは消したいので、失敗は無視する
    if let Ok(e) = entry(label) {
        let _ = e.delete_credential();
    }
}

/// Philly のキャラ(`<Philly フォルダ>/<表示名>.chara/.phirc`)。
pub struct PhillyCharacter {
    pub character: Character,
    pub id: String,
}

/// Philly フォルダから `.phirc` を探して読む。
///
/// `.phirc` は cp932 で、1行目が ID、2行目が `IP:ポート` か `IP ポート`(IpPort.cpp `SplitSet`)。
pub fn read_philly(root: &Path) -> Result<Vec<PhillyCharacter>, String> {
    let dirs = std::fs::read_dir(root).map_err(|e| format!("{}: {e}", root.display()))?;
    let mut found: Vec<PhillyCharacter> = dirs
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter_map(|dir| {
            let label = dir.file_name()?.to_str()?.strip_suffix(".chara")?.to_string();
            let text = codec::decode(&std::fs::read(phirc(&dir)).ok()?);
            let mut lines = text.lines().map(str::trim);
            let id = lines.next().filter(|s| !s.is_empty())?.to_string();
            let (host, port) = lines.next()?.split_once([':', ' ', '\t'])?;
            let port = port.trim_start_matches([':', ' ', '\t']).parse().ok()?;
            Some(PhillyCharacter {
                character: Character {
                    label,
                    host: host.to_string(),
                    port,
                },
                id,
            })
        })
        .collect();
    found.sort_by(|a, b| a.character.label.cmp(&b.character.label));
    Ok(found)
}

fn phirc(dir: &Path) -> PathBuf {
    dir.join(".phirc")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_philly_folder() {
        let root = std::env::temp_dir().join(format!("rust-philly-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for (dir, body) in [
            ("勇者.chara", codec::encode("ABC123\r\n192.0.2.1:9000\r\n")),
            ("b.chara", b"XYZ\n192.0.2.2 9001\n".to_vec()),
            ("broken.chara", b"ONLY_ID\n".to_vec()),
            ("notchara", b"X\n1.1.1.1:1\n".to_vec()),
        ] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
            std::fs::write(root.join(dir).join(".phirc"), body).unwrap();
        }
        let got: Vec<(String, String, u16, String)> = read_philly(&root)
            .unwrap()
            .into_iter()
            .map(|p| (p.character.label, p.character.host, p.character.port, p.id))
            .collect();
        assert_eq!(
            got,
            vec![
                ("b".into(), "192.0.2.2".into(), 9001, "XYZ".into()),
                ("勇者".into(), "192.0.2.1".into(), 9000, "ABC123".into()),
            ]
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn store_round_trip() {
        let path = std::env::temp_dir().join(format!("rust-philly-store-{}.json", std::process::id()));
        let mut s = Store::default();
        s.upsert(Character {
            label: "a".into(),
            host: "h".into(),
            port: 1,
        });
        s.upsert(Character {
            label: "a".into(),
            host: "h2".into(),
            port: 2,
        });
        s.open_tabs = vec!["a".into()];
        s.save(&path).unwrap();
        assert_eq!(Store::load(&path), s);
        assert_eq!(s.characters.len(), 1);
        std::fs::remove_file(&path).unwrap();
    }

    /// OS のキーチェーンを実際に使う。`cargo test -- --ignored` で手動で実行する。
    #[test]
    #[ignore]
    fn keyring_round_trip() {
        let label = "rust-philly-selftest";
        set_id(label, "SECRET").unwrap();
        assert_eq!(get_id(label).unwrap(), "SECRET");
        delete_id(label);
        assert!(get_id(label).is_err());
    }
}
