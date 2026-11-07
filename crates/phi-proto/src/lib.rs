//! レガシー PHI サーバ(cp932・改行区切りの行プロトコル)の行分割・文字コード変換・受信行の解析。
//!
//! 移植元は phi-client-web の `backend/app/protocol/`。
//! I/O を持たない純粋なコードだけを置き、接続は src-tauri 側が持つ。

pub mod codec;
pub mod line_buffer;
pub mod parser;
pub mod tag_to_html;

pub use line_buffer::LineBuffer;
pub use parser::{Event, Parser};
