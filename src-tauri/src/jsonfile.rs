//! 設定フォルダの JSON ファイル(characters.json・settings.json)の読み書き。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Serialize, de::DeserializeOwned};

/// load から save までを1つずつ行う。世界移動の書き戻し(接続のタスク)と UI からの保存が同時に走ると、
/// 後から保存した側が先の変更を消す為。
/// ponytail: 全ファイルで1つのロック。ファイルが増えて詰まるならファイルごとにする
static LOCK: Mutex<()> = Mutex::new(());

/// ファイルが無ければ既定値。壊れていれば `<名前>.bak` に退避してから既定値にする。
/// 退避せずに既定値を保存すると、キャラの一覧などが空で上書きされて消える。
pub fn load<T: DeserializeOwned + Default>(path: &Path) -> T {
    let Ok(s) = std::fs::read_to_string(path) else {
        return T::default();
    };
    match serde_json::from_str(&s) {
        Ok(v) => v,
        Err(e) => {
            let bak = with_suffix(path, ".bak");
            eprintln!(
                "{} が読めないので {} に退避しました: {e}",
                path.display(),
                bak.display()
            );
            let _ = std::fs::rename(path, &bak);
            T::default()
        }
    }
}

/// 一時ファイルに書いてから置き換える。書いている途中で落ちても元のファイルが残る。
pub fn save<T: Serialize>(path: &Path, v: &T) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    let tmp = with_suffix(path, ".tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

/// 読んで書き換えて保存する。f が Err を返したら保存しない。
pub fn update<T, R>(path: &Path, f: impl FnOnce(&mut T) -> Result<R, String>) -> Result<R, String>
where
    T: Serialize + DeserializeOwned + Default,
{
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut v = load(path);
    let r = f(&mut v)?;
    save(path, &v)?;
    Ok(r)
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broken_file_is_kept_as_bak() {
        let dir = std::env::temp_dir().join(format!("wphi-jsonfile-{}", std::process::id()));
        let path = dir.join("a.json");
        let _ = std::fs::remove_dir_all(&dir);

        // 無ければ既定値
        assert_eq!(load::<Vec<u32>>(&path), Vec::<u32>::new());

        update(&path, |v: &mut Vec<u32>| {
            v.push(1);
            Ok(())
        })
        .unwrap();
        assert_eq!(load::<Vec<u32>>(&path), vec![1]);
        assert!(!with_suffix(&path, ".tmp").exists());

        // f が失敗したら保存しない
        assert!(
            update(&path, |v: &mut Vec<u32>| {
                v.push(2);
                Err::<(), _>("x".into())
            })
            .is_err()
        );
        assert_eq!(load::<Vec<u32>>(&path), vec![1]);

        // 壊れていれば退避して既定値
        std::fs::write(&path, "{").unwrap();
        assert_eq!(load::<Vec<u32>>(&path), Vec::<u32>::new());
        assert_eq!(std::fs::read_to_string(with_suffix(&path, ".bak")).unwrap(), "{");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
