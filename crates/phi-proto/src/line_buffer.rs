//! 受信バイト列を `\n` で行に分ける。
//!
//! cp932 の2バイト目は 0x40-0x7E / 0x80-0xFC で 0x0A を含まない為、
//! `\n` で切っても2バイト文字を割らない。
//! 行末の `\r` を落とし、空行を捨てる処理は phi-client-web の `line_buffer.py` と同じ。

/// 1行の上限(バイト)。サーバが `\n` を送らずに流し続けても、メモリを使い切らない為(#52)。
/// 超えた行は丸ごと捨てる。
pub const MAX_LINE: usize = 64 * 1024;

#[derive(Default)]
pub struct LineBuffer {
    partial: Vec<u8>,
    /// 上限を超えた行の残りを、次の `\n` まで捨てている
    discarding: bool,
}

impl LineBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    /// `data` を足し、確定した行(`\n` を含まない)を返す。末尾の未確定分は次回へ持ち越す。
    pub fn feed(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        // 届いた分だけから `\n` を探す(溜めた分を毎回見直さない)
        let Some(last_nl) = data.iter().rposition(|&b| b == b'\n') else {
            self.keep(data);
            return Vec::new();
        };
        let skip_first = std::mem::take(&mut self.discarding);
        let mut done = std::mem::take(&mut self.partial);
        done.extend_from_slice(&data[..last_nl]);
        self.keep(&data[last_nl + 1..]);
        done.split(|&b| b == b'\n')
            // 最初の部分は、捨てている途中の行の残り
            .skip(usize::from(skip_first))
            .filter(|l| l.len() <= MAX_LINE)
            .map(|l| l.strip_suffix(b"\r").unwrap_or(l))
            .filter(|l| !l.is_empty())
            .map(<[u8]>::to_vec)
            .collect()
    }

    /// 未確定分に足す。上限を超えたら、その行を次の `\n` まで捨てる。
    fn keep(&mut self, data: &[u8]) {
        if self.discarding {
            return;
        }
        if self.partial.len() + data.len() > MAX_LINE {
            self.partial.clear();
            self.discarding = true;
        } else {
            self.partial.extend_from_slice(data);
        }
    }

    /// 持ち越し中の未確定分を捨てる(再接続時)。
    pub fn reset(&mut self) {
        self.partial.clear();
        self.discarding = false;
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

    #[test]
    fn drops_too_long_lines() {
        let mut lb = LineBuffer::new();
        let chunk = vec![b'a'; MAX_LINE / 2 + 1];
        assert!(lb.feed(&chunk).is_empty());
        assert!(lb.feed(&chunk).is_empty());
        // 上限を超えた行は残りも含めて捨て、次の行から戻る
        assert_eq!(lb.feed(b"tail\nnext\n"), vec![b"next".to_vec()]);
        // 1回で届いた長すぎる行も捨てる
        let mut big = vec![b'b'; MAX_LINE + 1];
        big.extend_from_slice(b"\nok\n");
        assert_eq!(lb.feed(&big), vec![b"ok".to_vec()]);
    }
}
