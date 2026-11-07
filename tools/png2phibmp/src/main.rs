//! phi-client-web の透過 PNG のキャラグラを、Philly が読む teal カラーキーの BMP に戻す。
//!
//! 使い方: `cargo run -p png2phibmp -- <PNG のフォルダ> <BMP の出力先>`
//!
//! PNG のアルファは 0 か 255 だけの前提で、半透明の画素や teal の不透明画素があれば止める。
//! どちらも BMP に戻すと見た目が変わる為である。

use std::{fs, path::Path, process::ExitCode};

use image::{Rgb, RgbImage, RgbaImage};

/// Philly のキャラグラの透過色 clTeal(ImageStore.cpp)。
const TEAL: Rgb<u8> = Rgb([0, 128, 128]);

fn to_colorkey_bmp(src: &RgbaImage) -> Result<RgbImage, String> {
    let mut out = RgbImage::new(src.width(), src.height());
    for (x, y, p) in src.enumerate_pixels() {
        let [r, g, b, a] = p.0;
        out.put_pixel(
            x,
            y,
            match a {
                0 => TEAL,
                255 if Rgb([r, g, b]) == TEAL => return Err(format!("({x},{y}) が不透明の teal")),
                255 => Rgb([r, g, b]),
                _ => return Err(format!("({x},{y}) が半透明(alpha={a})")),
            },
        );
    }
    Ok(out)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let [_, src_dir, out_dir] = args.as_slice() else {
        eprintln!("使い方: png2phibmp <PNG のフォルダ> <BMP の出力先>");
        return ExitCode::FAILURE;
    };
    fs::create_dir_all(out_dir).expect("出力先を作成出来ない");
    let mut entries: Vec<_> = fs::read_dir(src_dir)
        .expect("PNG のフォルダを読めない")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "png"))
        .collect();
    entries.sort();
    let mut failed = 0;
    for path in &entries {
        let result = image::open(path)
            .map_err(|e| e.to_string())
            .and_then(|img| to_colorkey_bmp(&img.to_rgba8()))
            .and_then(|bmp| {
                let out = Path::new(out_dir).join(path.with_extension("bmp").file_name().unwrap());
                bmp.save(out).map_err(|e| e.to_string())
            });
        if let Err(e) = result {
            eprintln!("{}: {e}", path.display());
            failed += 1;
        }
    }
    println!("{} 件中 {} 件を変換", entries.len(), entries.len() - failed);
    if failed == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn colorkey_round_trip() {
        let mut src = RgbaImage::new(2, 1);
        src.put_pixel(0, 0, Rgba([10, 20, 30, 255]));
        src.put_pixel(1, 0, Rgba([0, 0, 0, 0]));
        let bmp = to_colorkey_bmp(&src).unwrap();
        assert_eq!(bmp.get_pixel(0, 0), &Rgb([10, 20, 30]));
        assert_eq!(bmp.get_pixel(1, 0), &TEAL);

        src.put_pixel(0, 0, Rgba([0, 128, 128, 255]));
        assert!(to_colorkey_bmp(&src).is_err());
        src.put_pixel(0, 0, Rgba([1, 1, 1, 128]));
        assert!(to_colorkey_bmp(&src).is_err());
    }
}
