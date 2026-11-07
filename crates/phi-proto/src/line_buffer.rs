//! 受信バイト列を `\n` で行に分ける。
//!
//! cp932 の2バイト目は 0x40-0x7E / 0x80-0xFC で 0x0A を含まない為、
//! `\n` で切っても2バイト文字を割らない。
//! 行末の `\r` を落とし、空行を捨てる処理は phi-client-web の `line_buffer.py` と同じ。

#[derive(Default)]
pub struct LineBuffer {
    partial: Vec<u8>,
}

impl LineBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    /// `data` を足し、確定した行(`\n` を含まない)を返す。末尾の未確定分は次回へ持ち越す。
    pub fn feed(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        self.partial.extend_from_slice(data);
        let Some(last_nl) = self.partial.iter().rposition(|&b| b == b'\n') else {
            return Vec::new();
        };
        let rest = self.partial.split_off(last_nl + 1);
        let done = std::mem::replace(&mut self.partial, rest);
        done[..last_nl]
            .split(|&b| b == b'\n')
            .map(|l| l.strip_suffix(b"\r").unwrap_or(l))
            .filter(|l| !l.is_empty())
            .map(<[u8]>::to_vec)
            .collect()
    }

    /// 持ち越し中の未確定分を捨てる(再接続時)。
    pub fn reset(&mut self) {
        self.partial.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_across_chunks() {
        let mut lb = LineBuffer::new();
        // 「あ」(82 A0)の途中で割れても、行が確定するまで持ち越す
        assert!(lb.feed(b"#name \x82").is_empty());
        assert_eq!(
            lb.feed(b"\xa0\r\n\n#x\nrest"),
            vec![b"#name \x82\xa0".to_vec(), b"#x".to_vec()]
        );
        assert_eq!(lb.feed(b"\n"), vec![b"rest".to_vec()]);
        lb.feed(b"junk");
        lb.reset();
        assert_eq!(lb.feed(b"ok\n"), vec![b"ok".to_vec()]);
    }
}
