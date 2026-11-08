//! 登録したキャラの一覧と、開いていたタブの保存。
//!
//! キャラ ID はログインの認証情報そのものなので、UI には返さない。Windows は資格情報マネージャに、
//! macOS と Linux は設定フォルダの `<表示名>.chara/.phirc` に置く。
//! 一覧(表示名・接続先)と開いていたタブは、設定フォルダの `characters.json` に置く。

use std::path::{Path, PathBuf};

use phi_proto::codec;
use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "wphi";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Character {
    /// タブに出す表示名。ID の置き場のキーも兼ねるので一覧の中で重ならない。
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
        crate::jsonfile::load(path)
    }

    #[cfg(test)]
    pub fn save(&self, path: &Path) -> Result<(), String> {
        crate::jsonfile::save(path, self)
    }

    /// 読んで書き換えて保存する(`jsonfile::update`)。
    pub fn update<R>(path: &Path, f: impl FnOnce(&mut Store) -> Result<R, String>) -> Result<R, String> {
        crate::jsonfile::update(path, f)
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

// キャラ ID は設定フォルダに、Philly と同じ `<表示名>.chara/.phirc` で置く。
// 前の版は OS のキーチェーン(Windows は資格情報マネージャ)に置いていたが、macOS は開くたびに許可を求められる。
// macOS と Linux は自分だけが読める権限(0600)にする。Windows の設定フォルダ(%APPDATA%)は元から本人だけが読める。
// `dir` は設定フォルダ

fn phirc_path(dir: &Path, label: &str) -> PathBuf {
    dir.join(format!("{}.chara", crate::dir_name(label))).join(".phirc")
}

/// 1行目が ID、2行目が `接続先:ポート`(Philly の .phirc と同じ。Philly から取り込む時にも読める)
pub fn set_id(dir: &Path, ch: &Character, id: &str) -> Result<(), String> {
    use std::io::Write;
    let path = phirc_path(dir, &ch.label);
    let parent = path.parent().unwrap_or(dir);
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
        builder.mode(0o700);
        options.mode(0o600);
    }
    builder
        .create(parent)
        .map_err(|e| format!("{}: {e}", parent.display()))?;
    let mut f = options.open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    f.write_all(format!("{id}\n{}:{}\n", ch.host, ch.port).as_bytes())
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// .phirc が無ければ、前の版がキーチェーンに置いた ID を .phirc へ移す
pub fn get_id(dir: &Path, ch: &Character) -> Result<String, String> {
    let path = phirc_path(dir, &ch.label);
    if let Ok(bytes) = std::fs::read(&path) {
        return codec::decode(&bytes)
            .lines()
            .next()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .ok_or_else(|| format!("キャラ ID がありません({})", path.display()));
    }
    let id = entry(&ch.label)?.get_password().map_err(|_| {
        format!(
            "キャラ ID が見つかりません。キャラを登録し直してください({})",
            path.display()
        )
    })?;
    set_id(dir, ch, &id)?;
    if let Ok(e) = entry(&ch.label) {
        let _ = e.delete_credential();
    }
    Ok(id)
}

pub fn delete_id(dir: &Path, label: &str) {
    let path = phirc_path(dir, label);
    let _ = std::fs::remove_file(&path);
    // 移す前の、キーチェーンに残った分も消す
    if let Ok(e) = entry(label) {
        let _ = e.delete_credential();
    }
    if let Some(parent) = path.parent() {
        // 他に置いた物があれば消さない
        let _ = std::fs::remove_dir(parent);
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
            // Windows の Philly では大文字小文字を区別しないので、`.Chara` のフォルダもある
            let name = dir.file_name()?.to_str()?;
            let cut = name.len().checked_sub(".chara".len())?;
            let label = name
                .get(cut..)?
                .eq_ignore_ascii_case(".chara")
                .then(|| name[..cut].to_string())?;
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
        let root = std::env::temp_dir().join(format!("wphi-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for (dir, body) in [
            ("勇者.chara", codec::encode("ABC123\r\n192.0.2.1:9000\r\n")),
            ("b.Chara", b"XYZ\n192.0.2.2 9001\n".to_vec()),
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
        let path = std::env::temp_dir().join(format!("wphi-store-{}.json", std::process::id()));
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

    #[test]
    fn phirc_round_trip() {
        let dir = std::env::temp_dir().join(format!("wphi-phirc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let ch = Character {
            label: "勇者".into(),
            host: "192.0.2.1".into(),
            port: 9000,
        };
        set_id(&dir, &ch, "SECRET").unwrap();
        let path = dir.join("勇者.chara").join(".phirc");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "SECRET\n192.0.2.1:9000\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert_eq!(get_id(&dir, &ch).unwrap(), "SECRET");
        // Philly から取り込む時と同じ形で読める
        let read = read_philly(&dir).unwrap();
        assert_eq!((read[0].id.as_str(), read[0].character.port), ("SECRET", 9000));
        delete_id(&dir, &ch.label);
        assert!(!dir.join("勇者.chara").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
