//! キーチェーンのキャラ ID を、旧サービス名 `rust-philly` から `wphi` へ移す(2026-11-07 の名前の変更に伴う1回限りの移行)。
//!
//! 使い方: `cargo run -p wphi --example migrate_keyring -- ~/.config/dev.wphi/characters.json`
//!
//! ID は表示しない。移した表示名と、移せなかった表示名だけを出す。
//! 移行が済めばこのファイルは消してよい。

use serde_json::Value;

const OLD: &str = "rust-philly";
const NEW: &str = "wphi";

fn main() {
    let path = std::env::args().nth(1).expect("characters.json のパスを渡す");
    let store: Value = serde_json::from_str(&std::fs::read_to_string(&path).expect("characters.json を読めない"))
        .expect("characters.json が JSON でない");
    let labels = store["characters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| c["label"].as_str());
    for label in labels {
        let moved = (|| -> Result<(), String> {
            let old = keyring::Entry::new(OLD, label).map_err(|e| e.to_string())?;
            let id = old.get_password().map_err(|e| e.to_string())?;
            keyring::Entry::new(NEW, label)
                .and_then(|e| e.set_password(&id))
                .map_err(|e| e.to_string())?;
            old.delete_credential().map_err(|e| e.to_string())
        })();
        match moved {
            Ok(()) => println!("移した: {label}"),
            Err(e) => println!("移せなかった: {label} ({e})"),
        }
    }
}
