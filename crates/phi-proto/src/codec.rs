//! cp932 と UTF-8 の変換。
//!
//! encoding_rs の Shift_JIS(WHATWG)を使う。
//! Python の cp932 とは一部のバイト表現が違う(docs/01-design.md §3.3)。

use encoding_rs::{EncoderResult, SHIFT_JIS};

/// cp932 → UTF-8。不正なバイトは U+FFFD にする。
pub fn decode(raw: &[u8]) -> String {
    SHIFT_JIS.decode_without_bom_handling(raw).0.into_owned()
}

/// UTF-8 → cp932。変換出来ない文字は `?` にする。
///
/// `Encoder::encode_from_utf8` は変換出来ない文字を `&#NNNN;` に置き換え、
/// そのまま送るとチャットに文字参照が流れる為、置換を自前で行う。
pub fn encode(text: &str) -> Vec<u8> {
    let mut enc = SHIFT_JIS.new_encoder();
    let mut out = Vec::with_capacity(text.len() * 2);
    let mut buf = [0u8; 1024];
    let mut src = text;
    loop {
        let (res, read, written) = enc.encode_from_utf8_without_replacement(src, &mut buf, true);
        out.extend_from_slice(&buf[..written]);
        src = &src[read..];
        match res {
            EncoderResult::InputEmpty => return out,
            EncoderResult::OutputFull => {}
            EncoderResult::Unmappable(_) => out.push(b'?'),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_unmappable() {
        assert_eq!(decode(&encode("港町の酒場①")), "港町の酒場①");
        assert_eq!(encode("😀X"), b"?X");
        // 長い入力でバッファが一杯になっても途切れない
        let long = "あ".repeat(2000);
        assert_eq!(decode(&encode(&long)), long);
    }

    #[test]
    fn differs_from_python_cp932() {
        // Python cp932 は EE E0(NEC 選定 IBM 拡張)を返す。encoding_rs は IBM 拡張を選ぶ
        assert_eq!(encode("髙"), b"\xfb\xfc");
        // Python cp932 は U+F8F0 を返す
        assert_eq!(decode(b"\xa0"), "\u{FFFD}");
    }
}
