//! Philly の BMP を読み、透過を付けた PNG を `phi-asset://` で UI に返す。
//!
//! 探す場所は利用者の Philly フォルダ(登録されていれば)→ アプリを置いたフォルダ → 同梱の分の順。
//! 同梱の分(`resources/phi`)は実行ファイルに埋め込む(BUNDLED)。配布物の中にファイルとして並べない為である。
//! どれも Philly と同じフォルダ構成なので、相対パスは共通にしてある。
//! 透過方式は phi-client-web の `docs/06-graphics-transparency.md` と同じ。

use std::{
    collections::HashMap,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use image::{ImageFormat, Rgba, RgbaImage};
use include_dir::{Dir, include_dir};
use phi_proto::codec;

/// 同梱のグラフィックスとスキン(`resources/phi`)。ライセンスの文書だけは別にファイルとしても配る(tauri.conf.json)
static BUNDLED: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/../resources/phi");

/// 同梱の分から、大文字と小文字を無視して読む。
pub fn bundled(rel: &str) -> Option<&'static [u8]> {
    let same = |p: &Path, part: &str| {
        p.file_name()
            .is_some_and(|n| n.to_string_lossy().to_lowercase() == part.to_lowercase())
    };
    let (dirs, file) = rel.rsplit_once('/').unwrap_or(("", rel));
    let mut dir = &BUNDLED;
    for part in dirs.split('/').filter(|p| !p.is_empty()) {
        dir = dir.dirs().find(|d| same(d.path(), part))?;
    }
    dir.files().find(|f| same(f.path(), file)).map(|f| f.contents())
}

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
    /// 問い合わせ(種類・名前・グラ・種別・マップセット) → PNG。名前が違っても同じ絵なら PNG を共有する。
    /// ponytail: 上限を超えたら全部捨てる。捨てても converted が残るので、変換し直さない
    cache: Mutex<HashMap<String, Arc<Vec<u8>>>>,
    /// 元のファイル(相対パス)→ 変換済みの PNG。上限なし。キャラグラは1枚 20KB 前後で、ファイルの数だけしか増えない
    converted: Mutex<HashMap<String, Arc<Vec<u8>>>>,
    /// `chara/*.ali` の別名 → グラ名(Philly `LoadAliasFile`)。
    aliases: HashMap<String, String>,
}

impl Assets {
    /// `roots` は先に探す方から並べる。同梱の分は最後に探す。
    pub fn new(roots: Vec<PathBuf>) -> Self {
        let aliases = load_aliases(&roots);
        Self {
            roots,
            cache: Mutex::default(),
            converted: Mutex::default(),
            aliases,
        }
    }

    /// `phi-asset://` のパスとクエリから PNG を返す。見つからなければ `None`。
    pub fn get(&self, kind: &str, query: &HashMap<String, String>) -> Option<Vec<u8>> {
        let q = |k: &str| query.get(k).map(String::as_str).unwrap_or("");
        let key = format!("{kind}?{}&{}&{}&{}", q("name"), q("gra"), q("code"), q("mapset"));
        if let Some(png) = self.cache.lock().unwrap().get(&key) {
            return Some(png.to_vec());
        }
        // 元のファイルを決めてから変換する。同じグラを使う別の名前のキャラで変換し直さない
        let (rel, convert): (String, fn(&image::DynamicImage) -> RgbaImage) = match kind {
            "chara" => (
                self.chara(q("name"), q("gra"), q("code").parse().unwrap_or(0x01))?,
                |i| colorkey(i, TEAL),
            ),
            "chip" => (self.chip(q("mapset"))?, mask_h),
            "items" => (format!("Skins/{SKIN}/Images/Items.bmp"), mask_v),
            _ => return None,
        };
        // ロックは変換の間は持たない(match の中で持ったまま insert すると止まる)
        let done = self.converted.lock().unwrap().get(&rel).cloned();
        let png = match done {
            Some(png) => png,
            None => {
                let mut png = Vec::new();
                convert(&self.open(&rel)?)
                    .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
                    .ok()?;
                let png = Arc::new(png);
                self.converted.lock().unwrap().insert(rel, png.clone());
                png
            }
        };
        let mut cache = self.cache.lock().unwrap();
        if cache.len() >= 4096 {
            // 名前を変えながら送られても、メモリを使い切らないようにする
            cache.clear();
        }
        cache.insert(key, png.clone());
        Some(png.to_vec())
    }

    /// キャラグラのファイル(Philly `GraCache.cpp` の `classGraCacheCharaGra::Draw`)。
    ///
    /// setcg(0x40)はグラ名 → 別名 → キャラ名、それ以外は別名 → グラ名 → キャラ名の順に探し、
    /// 無ければ種別ごとの既定グラにする。
    fn chara(&self, name: &str, gra: &str, code: u32) -> Option<String> {
        let alias = self.aliases.get(name).map(String::as_str);
        let order = if code == 0x40 {
            [Some(gra), alias, Some(name)]
        } else {
            [alias, Some(gra), Some(name)]
        };
        order
            .into_iter()
            .flatten()
            .filter(|n| !n.is_empty())
            .map(|n| format!("chara/{n}.bmp"))
            .find(|rel| self.exists(rel))
            .or_else(|| self.default_chara(code))
    }

    /// 種別の既定グラのファイル。スキンの `Chara/Index.txt` を探す場所の順に見る。
    /// Index.txt のファイルはスキンの `Chara` から探し、無ければ `chara` から探す
    /// (同梱の Index.txt は PCGL のキャラグラを指している)。
    fn default_chara(&self, code: u32) -> Option<String> {
        let key = DEFAULT_GRA
            .iter()
            .find(|(c, _)| *c == code)
            .map_or("知的生物", |(_, k)| k);
        let index_rel = format!("Skins/{SKIN}/Chara/Index.txt");
        let indexes = self
            .roots
            .iter()
            .filter_map(|root| std::fs::read(find_path(root, &index_rel)?).ok())
            .chain(bundled(&index_rel).map(<[u8]>::to_vec));
        indexes.into_iter().find_map(|index| {
            let index = codec::decode(&index);
            let file = index
                .lines()
                .filter(|l| !l.trim_start().starts_with("//"))
                .find_map(|l| {
                    l.split_once('=')
                        .filter(|(k, _)| k.trim() == key)
                        .map(|(_, v)| v.trim().to_string())
                })?;
            [format!("Skins/{SKIN}/Chara/{file}"), format!("chara/{file}")]
                .into_iter()
                .find(|rel| self.exists(rel))
        })
    }

    /// マップチップのファイル。`chip/<mapset>.bmp` が無ければスキンの `chip/Default.bmp`。
    fn chip(&self, mapset: &str) -> Option<String> {
        Some(mapset)
            .filter(|m| !m.is_empty())
            .map(|m| format!("chip/{m}.bmp"))
            .filter(|rel| self.exists(rel))
            .or_else(|| Some(format!("Skins/{SKIN}/chip/Default.bmp")))
    }

    fn exists(&self, rel: &str) -> bool {
        safe_rel(rel)
            && !is_lanu(rel)
            && (self.roots.iter().any(|r| find_path(r, rel).is_some()) || bundled(rel).is_some())
    }

    fn open(&self, rel: &str) -> Option<image::DynamicImage> {
        image::load_from_memory_with_format(&self.read(rel)?, ImageFormat::Bmp).ok()
    }

    fn read(&self, rel: &str) -> Option<Vec<u8>> {
        if !safe_rel(rel) || is_lanu(rel) {
            return None;
        }
        self.roots
            .iter()
            .find_map(|root| std::fs::read(find_path(root, rel)?).ok())
            .or_else(|| bundled(rel).map(<[u8]>::to_vec))
    }
}

/// LANU 系のグラフィックスは使わない(2026-11-07 に作者が指定)。どこにあっても読まず、次の候補へ進む
fn is_lanu(rel: &str) -> bool {
    rel.rsplit('/')
        .next()
        .unwrap_or(rel)
        .to_lowercase()
        .starts_with("lanu_")
}

/// 探す場所の外を指さない相対パスか。名前とグラ名は他のプレイヤーやサーバが決める(発言の画像の URL からも届く)。
/// `..` で探す場所の外の画像を読ませたり、Windows で `\\host\share` を join させて SMB に繋がせ、
/// NTLM の認証情報を送らせたりしない為、`\`・`:`・`..`・空の部品を含むパスは読まない。
fn safe_rel(rel: &str) -> bool {
    rel.split('/')
        .all(|p| !p.is_empty() && p != "." && p != ".." && !p.contains(['\\', ':', '\0']))
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

    fn bundled_only() -> Assets {
        Assets::new(vec![])
    }

    fn decode(png: &[u8]) -> RgbaImage {
        image::load_from_memory(png).unwrap().to_rgba8()
    }

    fn query(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn chip_and_items_from_bundled_skin() {
        let a = bundled_only();
        let chip = decode(&a.get("chip", &query(&[("mapset", "no-such-mapset")])).unwrap());
        assert_eq!(chip.dimensions(), (512, 96));
        let items = decode(&a.get("items", &HashMap::new()).unwrap());
        assert_eq!(items.dimensions(), (960, 32));
        // 透明と不透明の両方がある
        assert!(chip.pixels().any(|p| p.0[3] == 0) && chip.pixels().any(|p| p.0[3] == 255));
    }

    #[test]
    fn chara_falls_back_like_philly() {
        let a = bundled_only();
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
        // イレイザー(0x07)は同梱の Index.txt で tak_bslime
        let eraser = a.get("chara", &query(&[("gra", "none"), ("code", "7")])).unwrap();
        let slime = colorkey(&a.open("chara/tak_bslime.bmp").unwrap(), TEAL);
        assert_eq!(decode(&eraser), slime);
        // 人・銅像(0x00)は t_man
        let man = a.get("chara", &query(&[("gra", "none"), ("code", "0")])).unwrap();
        assert_eq!(decode(&man), colorkey(&a.open("chara/t_man.bmp").unwrap(), TEAL));
    }

    /// 名前やグラ名で探す場所の外を指させない(他のプレイヤーが発言の画像の URL で送れる)
    #[test]
    fn rejects_paths_outside_roots() {
        let base = std::env::temp_dir().join(format!("wphi-trav-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("root/chara")).unwrap();
        // 探す場所(root)の外に、既定グラと見分けられる絵を置く
        std::fs::copy(
            concat!(env!("CARGO_MANIFEST_DIR"), "/../resources/phi/chara/t_dog.bmp"),
            base.join("outside.bmp"),
        )
        .unwrap();
        let a = Assets::new(vec![base.join("root")]);
        let man = colorkey(&a.open("chara/t_man.bmp").unwrap(), TEAL);
        for gra in ["../../outside", "..\\..\\outside", "\\\\127.0.0.1\\s\\x", "C:/x"] {
            let got = a.get("chara", &query(&[("gra", gra), ("code", "64")])).unwrap();
            assert_eq!(decode(&got), man, "{gra}");
        }
        assert!(a.get("chip", &query(&[("mapset", "../../outside")])).is_some());
        std::fs::remove_dir_all(&base).unwrap();
    }

    /// 同じグラを使う別の名前のキャラは、変換した PNG を共有する
    #[test]
    fn shares_converted_png() {
        let a = bundled_only();
        a.get("chara", &query(&[("name", "a"), ("gra", "t_dog"), ("code", "1")]))
            .unwrap();
        a.get("chara", &query(&[("name", "b"), ("gra", "t_dog"), ("code", "1")]))
            .unwrap();
        assert_eq!(a.cache.lock().unwrap().len(), 2);
        assert_eq!(a.converted.lock().unwrap().len(), 1);
    }

    /// LANU 系は、利用者の Philly フォルダにあっても読まない
    #[test]
    fn never_reads_lanu() {
        let root = std::env::temp_dir().join(format!("wphi-lanu-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("chara")).unwrap();
        // 既定グラ(setcg は t_man)と見分けられるよう、別の絵を LANU の名前で置く
        std::fs::copy(
            concat!(env!("CARGO_MANIFEST_DIR"), "/../resources/phi/chara/t_dog.bmp"),
            root.join("chara/LANU_Test.bmp"),
        )
        .unwrap();
        let a = Assets::new(vec![root.clone()]);
        assert!(a.open("chara/LANU_Test.bmp").is_none());
        // LANU を読まずに既定グラになる
        let got = a.get("chara", &query(&[("gra", "LANU_Test"), ("code", "64")])).unwrap();
        assert_eq!(decode(&got), colorkey(&a.open("chara/t_man.bmp").unwrap(), TEAL));
        std::fs::remove_dir_all(&root).unwrap();
    }
}

#[cfg(test)]
mod bench {
    use super::*;

    /// 同梱の全キャラグラとチップを変換する時間を測る。
    /// `cargo test --release -p wphi convert_time -- --ignored --nocapture` で実行する。
    #[test]
    #[ignore]
    fn convert_time() {
        let root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../resources/phi"));
        let names: Vec<String> = std::fs::read_dir(root.join("chara"))
            .unwrap()
            .filter_map(|e| e.ok()?.file_name().to_str()?.strip_suffix(".bmp").map(str::to_string))
            .collect();
        let a = Assets::new(vec![root]);
        let start = std::time::Instant::now();
        let chip = a.get("chip", &HashMap::new()).unwrap();
        let chip_time = start.elapsed();
        let start = std::time::Instant::now();
        for n in &names {
            a.get("chara", &[("gra".to_string(), n.clone())].into()).unwrap();
        }
        let all = start.elapsed();
        println!(
            "chip: {chip_time:?} ({} bytes), chara: {} 件で {all:?}、1件あたり {:?}",
            chip.len(),
            names.len(),
            all / names.len() as u32
        );
    }
}
