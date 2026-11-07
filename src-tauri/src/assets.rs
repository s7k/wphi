//! Philly の BMP を読み、透過を付けた PNG を `phi-asset://` で UI に返す。
//!
//! 探す場所は利用者の Philly フォルダ(登録されていれば)→ 同梱の `resources/phi` の順。
//! どちらも Philly と同じフォルダ構成なので、相対パスは共通にしてある。
//! 透過方式は phi-client-web の `docs/06-graphics-transparency.md` と同じ。

use std::{
    collections::HashMap,
    io::Cursor,
    path::{Path, PathBuf},
    sync::Mutex,
};

use image::{ImageFormat, Rgba, RgbaImage};
use phi_proto::codec;

/// 使っているスキン(Philly.ini の `SkinName`)。スキンの切り替えは P4。
const SKIN: &str = "Mine";
/// マスクの白の閾値。超えたら不透明(phi-client-web `transparency.py` の MASK_WHITE_THRESHOLD)。
const MASK_WHITE: u8 = 200;
const TEAL: [u8; 3] = [0, 128, 128];

/// `#m57 O` の種別 → スキンの `Chara/Index.txt` のキー(Philly `Const.cpp` の SKIN_CHARA_GRA)。
const DEFAULT_GRA: &[(u32, &str)] = &[
    (0x00, "人・銅像"),
    (0x01, "知的生物"),
    (0x02, "獣"),
    (0x03, "狂戦士"),
    (0x04, "魔法生物"),
    (0x05, "アンデッド"),
    (0x06, "精神体"),
    (0x07, "イレイザー"),
    (0x40, "setcg使用キャラ"),
    (0x80, "生物"),
    (0x81, "看板"),
    (0x82, "魔法エフェクト"),
    (0x70, "アニメオブジェ"),
    (0x75, "アニメなしオブジェ"),
];

pub struct Assets {
    roots: Vec<PathBuf>,
    /// 変換済みの PNG。ponytail: 上限なし。キャラグラは1枚 20KB 前後で数百枚なので、増えて困るまで Philly の LRU は真似ない
    cache: Mutex<HashMap<String, Vec<u8>>>,
    /// `chara/*.ali` の別名 → グラ名(Philly `LoadAliasFile`)。
    aliases: HashMap<String, String>,
}

impl Assets {
    /// `roots` は先に探す方から並べる。
    pub fn new(roots: Vec<PathBuf>) -> Self {
        let aliases = load_aliases(&roots);
        Self {
            roots,
            cache: Mutex::default(),
            aliases,
        }
    }

    /// `phi-asset://` のパスとクエリから PNG を返す。見つからなければ `None`。
    pub fn get(&self, kind: &str, query: &HashMap<String, String>) -> Option<Vec<u8>> {
        let q = |k: &str| query.get(k).map(String::as_str).unwrap_or("");
        let key = format!("{kind}?{}&{}&{}&{}", q("name"), q("gra"), q("code"), q("mapset"));
        if let Some(png) = self.cache.lock().unwrap().get(&key) {
            return Some(png.clone());
        }
        let img = match kind {
            "chara" => self.chara(q("name"), q("gra"), q("code").parse().unwrap_or(0x01))?,
            "chip" => mask_h(&self.chip(q("mapset"))?),
            "items" => mask_v(&self.open(&format!("Skins/{SKIN}/Images/Items.bmp"))?),
            _ => return None,
        };
        let mut png = Vec::new();
        img.write_to(&mut Cursor::new(&mut png), ImageFormat::Png).ok()?;
        self.cache.lock().unwrap().insert(key, png.clone());
        Some(png)
    }

    /// キャラグラ(Philly `GraCache.cpp` の `classGraCacheCharaGra::Draw`)。
    ///
    /// setcg(0x40)はグラ名 → 別名 → キャラ名、それ以外は別名 → グラ名 → キャラ名の順に探し、
    /// 無ければ種別ごとの既定グラにする。
    fn chara(&self, name: &str, gra: &str, code: u32) -> Option<RgbaImage> {
        let alias = self.aliases.get(name).map(String::as_str);
        let order = if code == 0x40 {
            [Some(gra), alias, Some(name)]
        } else {
            [alias, Some(gra), Some(name)]
        };
        let found = order
            .into_iter()
            .flatten()
            .filter(|n| !n.is_empty())
            .find_map(|n| self.open(&format!("chara/{n}.bmp")))
            .or_else(|| self.default_chara(code))?;
        Some(colorkey(&found, TEAL))
    }

    fn default_chara(&self, code: u32) -> Option<image::DynamicImage> {
        let key = DEFAULT_GRA
            .iter()
            .find(|(c, _)| *c == code)
            .map_or("知的生物", |(_, k)| k);
        let index = codec::decode(&self.read(&format!("Skins/{SKIN}/Chara/Index.txt"))?);
        let file = index
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .find_map(|l| {
                l.split_once('=')
                    .filter(|(k, _)| k.trim() == key)
                    .map(|(_, v)| v.trim().to_string())
            })?;
        self.open(&format!("Skins/{SKIN}/Chara/{file}"))
    }

    /// マップチップ。`chip/<mapset>.bmp` が無ければスキンの `chip/Default.bmp`。
    fn chip(&self, mapset: &str) -> Option<image::DynamicImage> {
        Some(mapset)
            .filter(|m| !m.is_empty())
            .and_then(|m| self.open(&format!("chip/{m}.bmp")))
            .or_else(|| self.open(&format!("Skins/{SKIN}/chip/Default.bmp")))
    }

    fn open(&self, rel: &str) -> Option<image::DynamicImage> {
        image::load_from_memory_with_format(&self.read(rel)?, ImageFormat::Bmp).ok()
    }

    fn read(&self, rel: &str) -> Option<Vec<u8>> {
        self.roots
            .iter()
            .find_map(|root| std::fs::read(find_path(root, rel)?).ok())
    }
}

/// `root` からの相対パスを、大文字と小文字を無視して探す。
/// Philly は Windows 用で `Chara` と `chara` のように揃っていない為、Linux でも見つかるようにする。
fn find_path(root: &Path, rel: &str) -> Option<PathBuf> {
    let mut path = root.to_path_buf();
    for part in rel.split('/') {
        let exact = path.join(part);
        if exact.exists() {
            path = exact;
            continue;
        }
        let lower = part.to_lowercase();
        path = std::fs::read_dir(&path)
            .ok()?
            .filter_map(|e| e.ok())
            .find(|e| e.file_name().to_string_lossy().to_lowercase() == lower)?
            .path();
    }
    Some(path)
}

/// `chara/*.ali` の各行 `<グラ名> <別名>` を読む。先に探す場所の定義を優先する。
fn load_aliases(roots: &[PathBuf]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for root in roots.iter().rev() {
        let Some(dir) = find_path(root, "chara") else { continue };
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for e in entries.filter_map(|e| e.ok()) {
            if !e.file_name().to_string_lossy().to_lowercase().ends_with(".ali") {
                continue;
            }
            let Ok(bytes) = std::fs::read(e.path()) else { continue };
            for line in codec::decode(&bytes).lines() {
                if let Some((gra, alias)) = line.trim().split_once(char::is_whitespace) {
                    map.insert(alias.trim().to_string(), gra.to_string());
                }
            }
        }
    }
    map
}

/// `key` の色を透明にする(キャラグラ、HP/MP パネルなど)。
fn colorkey(img: &image::DynamicImage, key: [u8; 3]) -> RgbaImage {
    let mut out = img.to_rgba8();
    for p in out.pixels_mut() {
        if p.0[..3] == key {
            *p = Rgba([0, 0, 0, 0]);
        }
    }
    out
}

/// 左半分が画像、右半分がマスク(マップチップ)。
fn mask_h(img: &image::DynamicImage) -> RgbaImage {
    let rgb = img.to_rgb8();
    let (w, h) = (rgb.width() / 2, rgb.height());
    RgbaImage::from_fn(w, h, |x, y| masked(rgb.get_pixel(x, y).0, rgb.get_pixel(x + w, y).0))
}

/// 上半分が画像、下半分がマスク(Items.bmp)。
fn mask_v(img: &image::DynamicImage) -> RgbaImage {
    let rgb = img.to_rgb8();
    let (w, h) = (rgb.width(), rgb.height() / 2);
    RgbaImage::from_fn(w, h, |x, y| masked(rgb.get_pixel(x, y).0, rgb.get_pixel(x, y + h).0))
}

fn masked([r, g, b]: [u8; 3], mask: [u8; 3]) -> Rgba<u8> {
    if mask.iter().all(|&m| m > MASK_WHITE) {
        Rgba([r, g, b, 255])
    } else {
        Rgba([0, 0, 0, 0])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled() -> Assets {
        Assets::new(vec![PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../resources/phi"
        ))])
    }

    fn decode(png: &[u8]) -> RgbaImage {
        image::load_from_memory(png).unwrap().to_rgba8()
    }

    fn query(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn chip_and_items_from_bundled_skin() {
        let a = bundled();
        let chip = decode(&a.get("chip", &query(&[("mapset", "no-such-mapset")])).unwrap());
        assert_eq!(chip.dimensions(), (512, 96));
        let items = decode(&a.get("items", &HashMap::new()).unwrap());
        assert_eq!(items.dimensions(), (960, 32));
        // 透明と不透明の両方がある
        assert!(chip.pixels().any(|p| p.0[3] == 0) && chip.pixels().any(|p| p.0[3] == 255));
    }

    #[test]
    fn chara_falls_back_like_philly() {
        let a = bundled();
        // 同梱にあるグラ名はそのまま使う
        let npc = decode(
            &a.get("chara", &query(&[("name", "x"), ("gra", "npc2"), ("code", "1")]))
                .unwrap(),
        );
        assert_eq!(npc.dimensions(), (96, 160));
        // 無いグラ名は種別の既定グラ(看板 0x81 → Defboardobj.bmp)
        let board = a
            .get("chara", &query(&[("name", "x"), ("gra", "none"), ("code", "129")]))
            .unwrap();
        let direct = colorkey(&a.open("Skins/Mine/Chara/Defboardobj.bmp").unwrap(), TEAL);
        assert_eq!(decode(&board), direct);
        // 表に無い種別は知的生物
        assert!(a.get("chara", &query(&[("gra", "none"), ("code", "99")])).is_some());
    }
}
