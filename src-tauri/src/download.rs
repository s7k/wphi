//! キャラグラ・マップチップ・新規接続の設定のダウンロード(Raphi の更新ツールの unew.ini に当たる)。
//!
//! 一覧は同梱の `Config/unew.ini`。各節の `URL` の LZH を取り、`exOption` の展開先(`chip\` など)へ展開する。
//! 展開先は設定フォルダの `data`。画像はここも探す(main.rs の `load_assets`)。
//! BGM は鳴らさないので(#20)一覧から外す。

use std::{collections::HashMap, io::Read, path::Path};

use phi_proto::codec;
use serde::Serialize;

/// 1つの LZH の上限。一番大きい chara_tofup で 3MB 弱
const MAX_BYTES: u64 = 30 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// 節の名前(`Schedule3` など)
    pub id: String,
    pub title: String,
    pub url: String,
    /// 展開先。`data` からの相対(`chip`、`chara`)。空なら `data` の直下
    pub dir: String,
    /// 配布元の更新日。取った時の物と違えば、新しい版がある
    pub date: String,
}

/// unew.ini の `[ScheduleN]` を読む。キーの大文字と小文字は区別しない(`title` と書いた節がある)
pub fn items(ini: &str) -> Vec<Item> {
    let mut sections: Vec<(String, HashMap<String, String>)> = Vec::new();
    for line in ini.lines() {
        let line = line.trim();
        if let Some(s) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            sections.push((s.to_string(), HashMap::new()));
        } else if let (Some((k, v)), Some((_, map))) = (line.split_once('='), sections.last_mut()) {
            map.insert(k.trim().to_lowercase(), v.trim().trim_matches('"').to_string());
        }
    }
    sections
        .into_iter()
        .filter(|(s, _)| s.starts_with("Schedule"))
        .filter_map(|(id, m)| {
            // exOption は UNLHA32 の引数。`-m1 chip\ *.*` の `chip\` が展開先
            let dir = m
                .get("exoption")?
                .split_whitespace()
                .find(|a| a.ends_with('\\'))
                .unwrap_or("")
                .trim_end_matches('\\')
                .replace('\\', "/")
                .to_lowercase();
            if dir.starts_with("sound") {
                return None;
            }
            Some(Item {
                id,
                title: m.get("title")?.clone(),
                url: m.get("url")?.clone(),
                dir,
                date: m.get("date").cloned().unwrap_or_default(),
            })
        })
        .collect()
}

pub fn fetch(url: &str) -> Result<Vec<u8>, String> {
    ureq::get(url)
        .call()
        .and_then(|mut r| r.body_mut().with_config().limit(MAX_BYTES).read_to_vec())
        .map_err(|e| format!("{url} を取れません: {e}"))
}

/// LZH を `dest` に展開し、書いたファイルの名前を返す。中のフォルダは無視し、ファイル名だけで置く
pub fn extract(lzh: &[u8], dest: &Path) -> Result<Vec<String>, String> {
    let err = |e: &dyn std::fmt::Display| format!("LZH を展開出来ません: {e}");
    let mut rd = delharc::LhaDecodeReader::new(lzh).map_err(|e| err(&e))?;
    let mut names = Vec::new();
    loop {
        let h = rd.header();
        if !h.is_directory() {
            let Some(name) = file_name(&h.parse_pathname_to_str()) else {
                return Err(err(&"ファイル名が不正です"));
            };
            if !rd.is_decoder_supported() {
                return Err(err(&format!("{name} の圧縮の形式に対応していません")));
            }
            let mut buf = Vec::new();
            rd.read_to_end(&mut buf).map_err(|e| err(&e))?;
            rd.crc_check().map_err(|e| err(&e))?;
            std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
            std::fs::write(dest.join(&name), buf).map_err(|e| e.to_string())?;
            names.push(name);
        }
        if !rd.next_file().map_err(|e| err(&e))? {
            break;
        }
    }
    Ok(names)
}

/// 中のパスの最後の部分。`..` や空の物は使わない
fn file_name(path: &str) -> Option<String> {
    let name = path.rsplit(['/', '\\']).next()?;
    (!name.is_empty() && name != "." && name != "..").then(|| name.to_string())
}

/// 新規接続の設定(resist.ini)の世界
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct World {
    pub name: String,
    pub host: String,
    pub port: u16,
}

pub fn worlds(resist_ini: &[u8]) -> Vec<World> {
    let text = codec::decode(resist_ini);
    let mut out: Vec<World> = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some(s) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            out.push(World {
                name: s.to_string(),
                host: String::new(),
                port: 0,
            });
        } else if let (Some((k, v)), Some(w)) = (line.split_once('='), out.last_mut()) {
            match k.trim().to_lowercase().as_str() {
                "address" => w.host = v.trim().to_string(),
                "port" => w.port = v.trim().parse().unwrap_or(0),
                _ => {}
            }
        }
    }
    out.retain(|w| !w.host.is_empty() && w.port != 0);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_unew_ini() {
        let ini = "[Config]\nTitleHead=\"Ra\"\n\
            [Schedule3]\nTitle=\"マップチップ(PCGL)\"\nURL=\"http://x/chip_pcgl.lzh\"\nexOption=\"-m1 chip\\ *.*\"\nDate=\"Sat, 09 Jan 2010\"\n\
            [Schedule5]\ntitle=\"小文字\"\nURL=\"http://x/a.lzh\"\nexOption=\"-m1 chara\\ *.*\"\n\
            [Schedule12]\nTitle=\"音楽\"\nURL=\"http://x/b.lzh\"\nexOption=\"-m1 sound\\bgm\\ *.*\"\n\
            [Schedule15]\nTitle=\"新規接続設定ファイル\"\nURL=\"http://x/resist.lzh\"\nexOption=\"-m1\"\n";
        let got = items(ini);
        assert_eq!(
            got.iter().map(|i| (i.id.as_str(), i.dir.as_str())).collect::<Vec<_>>(),
            [("Schedule3", "chip"), ("Schedule5", "chara"), ("Schedule15", "")]
        );
        assert_eq!(got[0].title, "マップチップ(PCGL)");
        assert_eq!(got[0].date, "Sat, 09 Jan 2010");
        assert_eq!(got[1].title, "小文字");
    }

    /// 同梱の unew.ini が読める事
    #[test]
    fn bundled_unew_ini() {
        let ini = codec::decode(crate::assets::bundled("Config/unew.ini").unwrap());
        let got = items(&ini);
        assert!(got.iter().any(|i| i.dir == "chara"));
        assert!(got.iter().any(|i| i.dir == "chip"));
        assert!(got.iter().all(|i| !i.dir.starts_with("sound")));
    }

    #[test]
    fn file_name_drops_folders() {
        assert_eq!(file_name("MapChip/ryur.bmp").as_deref(), Some("ryur.bmp"));
        assert_eq!(file_name("a\\..\\b.bmp").as_deref(), Some("b.bmp"));
        assert_eq!(file_name("x/.."), None);
        assert_eq!(file_name("dir/"), None);
    }

    #[test]
    fn extracts_lh0() {
        // 無圧縮(-lh0-)・レベル0のヘッダを1つ組み立てる
        let data = b"hello";
        let name = b"sub\\a.bmp";
        let mut h = vec![0u8, 0];
        h.extend_from_slice(b"-lh0-");
        h.extend_from_slice(&(data.len() as u32).to_le_bytes());
        h.extend_from_slice(&(data.len() as u32).to_le_bytes());
        h.extend_from_slice(&[0, 0, 0x21, 0]); // 時刻
        h.extend_from_slice(&[0x20, 0]); // 属性・レベル
        h.push(name.len() as u8);
        h.extend_from_slice(name);
        h.extend_from_slice(&crc16(data).to_le_bytes());
        h[0] = (h.len() - 2) as u8;
        h[1] = h[2..].iter().fold(0u8, |a, b| a.wrapping_add(*b));
        h.extend_from_slice(data);
        h.push(0);
        let dir = std::env::temp_dir().join(format!("wphi-lzh-{}", std::process::id()));
        let names = extract(&h, &dir).unwrap();
        assert_eq!(names, ["a.bmp"]);
        assert_eq!(std::fs::read(dir.join("a.bmp")).unwrap(), data);
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn crc16(data: &[u8]) -> u16 {
        data.iter().fold(0u16, |mut c, b| {
            c ^= *b as u16;
            for _ in 0..8 {
                c = if c & 1 != 0 { (c >> 1) ^ 0xA001 } else { c >> 1 };
            }
            c
        })
    }

    #[test]
    fn reads_resist_ini() {
        let ini = codec::encode("[Metro Planetarium]\nAddress=192.0.2.1\nPort=20033\nLine1=遥か\n[壊れ]\nAddress=x\n");
        assert_eq!(
            worlds(&ini),
            [World {
                name: "Metro Planetarium".into(),
                host: "192.0.2.1".into(),
                port: 20033
            }]
        );
    }
}
