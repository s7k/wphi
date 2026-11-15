//! 受信行を解析してイベントにする。
//!
//! 移植元は phi-client-web の `backend/app/protocol/parser.py`。
//! イベントの形は同リポジトリの `docs/07-ws-protocol.md` §6 と同じにしてあり、
//! `tests/golden.rs` で Python 版と出力を比べている。
//!
//! マップは `M`(地形)・`O`(キャラ)・`.`(確定)の複数行に分かれて届くので、
//! 確定行が来るまでパーサがフレームを溜める。

use serde::Serialize;

use crate::codec::decode;

const MAP_CELLS: usize = 49;
const M57_DIRECTION_OFFSET: usize = 7;
const M57_CHIP_OFFSET: usize = 18;
const MAP_CHIP_BYTE: usize = MAP_CELLS * 2;
const MAX_EAGLE_EYE_COUNT: usize = 15;

/// `#status` の名前以降の10項目。
const STATUS_KEYS: usize = 10;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    Notice(Notice),
    Status(Status),
    Cond(Cond),
    Connection {
        state: ConnectionState,
    },
    /// サーバへ自動で返す行。セッション層が応答し、UI には渡さない。
    #[serde(rename = "_internal")]
    Internal {
        action: InternalAction,
    },
    Mode(Mode),
    List {
        active: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        lines: Option<Vec<String>>,
    },
    Edit {
        mode: EditMode,
    },
    UserList {
        users: Vec<User>,
    },
    Message(Message),
    Map(Map),
    EagleEye(EagleEye),
    WorldTransfer {
        state: WorldTransferState,
        server: String,
    },
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct Notice {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mapset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub area: Option<String>,
    /// `#mapset-define <番号> <マップセット>`。属性の下位2ビットが番号のマスは、このマップセットのチップで描く。
    /// 0 は `#mapset` の分。`default` はスキンの既定のチップ(Philly の RegistMapChipDefine)
    #[serde(rename = "mapsetDefine", skip_serializing_if = "Option::is_none")]
    pub mapset_define: Option<(u8, String)>,
}

/// `#status 名前 : HP : MaxHP : MP : MaxMP : Exp : GP : F : W : M : C`。数値に出来ない項目は省く。
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_hp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_mp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub w: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub m: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub c: Option<i64>,
}

/// `#cond` の7文字。`*` が有効。
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct Cond {
    pub poison: bool,
    pub palsy: bool,
    pub panic: bool,
    pub confuse: bool,
    pub berserk: bool,
    pub silence: bool,
    pub blind: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InternalAction {
    /// `#end-lag` を返す。
    Lag,
    /// `#map` を返す。
    Remap,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize)]
pub struct Mode {
    pub attack: bool,
    pub magic: bool,
    pub list: bool,
    pub more: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EditMode {
    Single,
    Multi,
    End,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct User {
    /// サーバのユーザ番号を `u<番号>` にしたもの。
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Log,
    Priv,
    /// `#user` に載っているプレイヤーの発言。
    Talk,
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Message {
    pub channel: Channel,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// カラーマークアップ(`/*...*/`)を含むか。
    pub markup: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize)]
pub struct Cell {
    pub chip: u8,
    pub attr: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Pos {
    pub x: i64,
    pub y: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Magnify {
    pub w: i64,
    pub h: i64,
    pub z: i64,
}

/// `#m57 O` の1キャラ。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Chara {
    pub id: u32,
    pub x: u8,
    pub y: u8,
    /// `B` `R` `F` `L`。
    pub dir: char,
    pub name: String,
    pub gra: String,
    pub status: u32,
    pub gigant: char,
    pub layer: u8,
    pub default: u32,
    /// `#ex-obj S` で拡大を指定したキャラ。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub magnify: Option<Magnify>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Map {
    /// 幅と高さのマス数。`#m57` は 7、`#v6` は `#v6 M` の W と H
    pub width: u8,
    pub height: u8,
    /// 自キャラの向き。N=0 から時計回りに45度刻み。
    pub dir: u8,
    pub cells: Vec<Cell>,
    pub chars: Vec<Chara>,
    /// サーバが返した `#ex-map style=` の値。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    /// `#ex-pos` の絶対座標(x は東、y は南へ増える)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pos: Option<Pos>,
    /// `#v6` で届いた地図(docs/05-protocol-v6.md)。Python 版の出力と比べるので、偽の時は出さない
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub v6: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EagleEye {
    pub width: i64,
    pub height: i64,
    #[serde(rename = "self")]
    pub self_pos: Pos,
    /// `width * height` 個を行優先で並べる。
    pub cells: Vec<Cell>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mapset: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorldTransferState {
    Start,
}

/// `#ex-eagleeye start` から `end` までの行を溜める。
struct EagleEyeAccum {
    grid: [[Cell; MAX_EAGLE_EYE_COUNT]; MAX_EAGLE_EYE_COUNT],
    size_x: i64,
    size_y: i64,
    pos: Pos,
}

impl Default for EagleEyeAccum {
    fn default() -> Self {
        Self {
            grid: [[Cell::default(); MAX_EAGLE_EYE_COUNT]; MAX_EAGLE_EYE_COUNT],
            size_x: 0,
            size_y: 0,
            pos: Pos { x: 0, y: 0 },
        }
    }
}

impl EagleEyeAccum {
    fn feed_line(&mut self, raw: &[u8]) {
        if raw.len() < 14 {
            return;
        }
        let tail = &raw[13..];
        if tail.starts_with(b"start") {
            *self = Self::default();
        } else if tail[0] == b'M' {
            self.parse_row(raw);
        } else if tail.starts_with(b"pos") {
            self.parse_pos(raw);
        }
    }

    /// `#ex-eagleeye M <幅> <y> ` の21バイトの後に (chip, attr) が並ぶ。
    fn parse_row(&mut self, raw: &[u8]) {
        let header = &raw[..raw.len().min(21)];
        let Ok(header) = std::str::from_utf8(header) else {
            return;
        };
        if !header.is_ascii() {
            return;
        }
        let parts: Vec<&str> = header.split_whitespace().collect();
        if parts.len() < 4 {
            return;
        }
        let (Some(size), Some(y)) = (py_int(parts[2]), py_int(parts[3])) else {
            return;
        };
        if !(0..MAX_EAGLE_EYE_COUNT as i64).contains(&y) {
            return;
        }
        self.size_y = self.size_y.max(y + 1);
        self.size_x = (size + 1).min(MAX_EAGLE_EYE_COUNT as i64);
        for x in 0..self.size_x.max(0) as usize {
            let i = 21 + x * 2;
            if i + 1 >= raw.len() {
                break;
            }
            self.grid[y as usize][x] = Cell {
                chip: raw[i],
                attr: raw[i + 1],
            };
        }
    }

    fn parse_pos(&mut self, raw: &[u8]) {
        if !raw.is_ascii() {
            return;
        }
        let text = std::str::from_utf8(raw).unwrap_or_default();
        let parts: Vec<&str> = text.split_whitespace().collect();
        if parts.len() < 4 {
            return;
        }
        // Python 版と同じく、x だけ読めて y で失敗した時も x は更新する
        let Some(x) = py_int(parts[2]) else { return };
        self.pos.x = x;
        let Some(y) = py_int(parts[3]) else { return };
        self.pos.y = y;
    }

    fn build(&self, mapset: Option<String>) -> EagleEye {
        let (w, h) = (self.size_x.max(0) as usize, self.size_y.max(0) as usize);
        let cells = (0..h)
            .flat_map(|y| (0..w).map(move |x| (y, x)))
            .map(|(y, x)| self.grid[y][x])
            .collect();
        EagleEye {
            width: self.size_x,
            height: self.size_y,
            self_pos: self.pos,
            cells,
            mapset,
        }
    }
}

/// リストの行の上限。実際のリストは数十行。
const MAX_LIST_LINES: usize = 1000;
/// 1フレームのキャラの上限。15x15 のマップに 1マス数人でも足りる。
const MAX_MAP_CHARS: usize = 1000;

/// 状態を持つ行パーサ。1行から0個以上のイベントを返す。
#[derive(Default)]
pub struct Parser {
    mode: Mode,
    in_more: bool,
    in_list: bool,
    list_lines: Vec<String>,

    map_dir: u8,
    map_cells: Option<Vec<Cell>>,
    map_chars: Vec<Chara>,
    /// 次フレームの最初の `O` 行で `map_chars` を空にする(Philly の SetCharaGraDataClearFlag)。
    chara_clear_pending: bool,
    /// `#ex-obj S` の表示名 → 拡大率。
    name_magnify: Vec<(String, Magnify)>,
    /// `#user` の名前 → 番号。届いた順を保つ。
    ulist: Vec<(String, i64)>,

    /// `#v6 M` の幅と高さと、届いた `#v6 R` の行(行番号の位置)。`#v6 .` で全部揃っていれば地図にする
    v6_size: (u8, u8),
    v6_rows: Vec<Option<Vec<Cell>>>,

    eagle: EagleEyeAccum,
    mapset: Option<String>,
    map_style: Option<String>,
    abs_pos: Option<Pos>,
}

impl Parser {
    pub fn new() -> Self {
        Self::default()
    }

    /// `#more` 〜 `#end-more` の中か。この間の行は看板などの本文で、サーバの通知ではない。
    pub fn in_more(&self) -> bool {
        self.in_more
    }

    /// `#ulist` を送る時に呼ぶ。届き直す `#user` だけの一覧にする(Philly の RequestUlist)。
    pub fn clear_users(&mut self) {
        self.ulist.clear();
    }

    /// サーバが最後に返した `#ex-map style=` の値(`turn` か `solid`)。
    pub fn map_style(&self) -> Option<&str> {
        self.map_style.as_deref()
    }

    /// `#user` で届いた名前のユーザ番号。priv の宛先を決める為に使う。
    pub fn user_no(&self, name: &str) -> Option<i64> {
        self.ulist.iter().find(|(n, _)| n == name).map(|&(_, no)| no)
    }

    pub fn feed(&mut self, raw: &[u8]) -> Vec<Event> {
        if raw.is_empty() {
            return Vec::new();
        }
        // #more 〜 #end-more(看板の本文など)は #end-more 以外をログにする(Philly の PersonalThread.cpp:707-858)。
        // 看板に #ch-srv などを書かれても、コマンドとして実行しない為である。
        // 移植元の Python 版は #more の間もコマンドを解析するので、ここは Python 版と違う
        if self.in_more {
            if raw.starts_with(b"#end-more") {
                self.in_more = false;
                return self.set_mode(|m| m.more = false);
            }
            return vec![message(Channel::Log, decode(raw), None)];
        }

        let is_command = raw[0] == b'#' && raw.len() > 1 && raw[1] != b'#' && raw[1] != b' ';
        if is_command {
            // 地形はバイナリなのでデコードしない
            if raw.starts_with(b"#m57 M") {
                self.parse_m57_m(raw);
                return Vec::new();
            }
            if raw.starts_with(b"#v6 R ") {
                self.parse_v6_r(raw);
                return Vec::new();
            }
            let text = decode(raw);
            return self.dispatch_command(&text, raw);
        }

        if self.in_list {
            // `#end-list` が来ないまま増え続けないよう上限を置く(#52)
            if self.list_lines.len() < MAX_LIST_LINES {
                self.list_lines.push(decode(raw));
            }
            return Vec::new();
        }

        let text = decode(raw);
        // "[送り主] > 本文" は priv
        if raw[0] == b'['
            && let Some(end) = text.find(']').filter(|&e| e > 0)
            && text[end + 1..].trim_start().starts_with('>')
        {
            let from = text[1..end].to_string();
            return vec![message(Channel::Priv, text, Some(from))];
        }
        // "名前 > 本文" で名前が #user にあればプレイヤーの発言。NPC と DM の案内は載っていない
        if let Some(idx) = text.find(" > ").filter(|&i| i > 0) {
            let name = &text[..idx];
            if self.user_no(name).is_some() {
                let from = name.to_string();
                return vec![message(Channel::Talk, text, Some(from))];
            }
        }
        vec![message(Channel::Log, text, None)]
    }

    /// リストを閉じる。v5y は `#ex-list-mode-end` を送らないので、選択・取消の送信時にも呼ぶ。
    pub fn end_list(&mut self) -> Vec<Event> {
        self.in_list = false;
        self.list_lines.clear();
        let mut evs = vec![Event::List {
            active: false,
            lines: None,
        }];
        evs.extend(self.set_mode(|m| m.list = false));
        evs
    }

    fn dispatch_command(&mut self, text: &str, raw: &[u8]) -> Vec<Event> {
        if let Some(name) = text.strip_prefix("#name ") {
            return vec![Event::Notice(Notice {
                name: Some(name.into()),
                ..Default::default()
            })];
        }
        if text.starts_with("#status ") || text == "#status" {
            return vec![Event::Status(parse_status(text))];
        }
        if text.starts_with("#cond ") {
            return vec![Event::Cond(parse_cond(text))];
        }
        match text {
            "#close" | "#x" => {
                return vec![Event::Connection {
                    state: ConnectionState::Closed,
                }];
            }
            "#lag" => {
                return vec![Event::Internal {
                    action: InternalAction::Lag,
                }];
            }
            "#remap" => {
                return vec![Event::Internal {
                    action: InternalAction::Remap,
                }];
            }
            "#more" => {
                self.in_more = true;
                return self.set_mode(|m| m.more = true);
            }
            "#end-more" => {
                self.in_more = false;
                return self.set_mode(|m| m.more = false);
            }
            "#list" => {
                self.in_list = true;
                self.list_lines.clear();
                let mut evs = self.set_mode(|m| m.list = true);
                evs.push(Event::List {
                    active: true,
                    lines: Some(Vec::new()),
                });
                return evs;
            }
            "#attack" => return self.set_mode(|m| m.attack = true),
            "#end-at" => return self.set_mode(|m| m.attack = false),
            "#magic" => return self.set_mode(|m| m.magic = true),
            "#end-mg" => return self.set_mode(|m| m.magic = false),
            "#ex-list-mode-end" => return self.end_list(),
            "#m57 ." => return self.finish_map(),
            "#v6 ." => return self.finish_v6(),
            "#ex-eagleeye end" => {
                return vec![Event::EagleEye(self.eagle.build(self.mapset.clone()))];
            }
            "#m-edit" => return vec![Event::Edit { mode: EditMode::Multi }],
            "#s-edit" => return vec![Event::Edit { mode: EditMode::Single }],
            "#." => return vec![Event::Edit { mode: EditMode::End }],
            "#ex-map style=turn" | "#ex-map style=solid" => {
                // 入力欄から直接送っても切り替わるので、サーバの返答を正とする
                self.map_style = Some(text["#ex-map style=".len()..].to_string());
                return Vec::new();
            }
            _ => {}
        }
        if text.starts_with("#end-list") {
            // リストの中身の終わり。選択肢は表示したままにする
            self.in_list = false;
            let lines = std::mem::take(&mut self.list_lines);
            return vec![Event::List {
                active: true,
                lines: Some(lines),
            }];
        }
        if raw.starts_with(b"#m57 O ") {
            self.parse_m57_o(raw, 7, 1);
            return Vec::new();
        }
        if raw.starts_with(b"#v6 O ") {
            self.parse_m57_o(raw, 6, 2);
            return Vec::new();
        }
        if let Some(rest) = text.strip_prefix("#v6 M ") {
            self.parse_v6_m(raw, rest);
            return Vec::new();
        }
        if raw.starts_with(b"#m57 W ") {
            // 1行に2キャラ: raw[7..74] と raw[75..142]
            for (from, to) in [(7, 74), (75, 142)] {
                if raw.len() >= to {
                    self.parse_m57_o(&[b"#m57 O ", &raw[from..to]].concat(), 7, 1);
                }
            }
            return Vec::new();
        }
        if text.starts_with("#ex-eagleeye ") {
            self.eagle.feed_line(raw);
            return Vec::new();
        }
        if text.starts_with("#ex-obj S ") {
            self.parse_ex_obj(text);
            return Vec::new();
        }
        if text.starts_with("#user ") {
            return self.parse_user(raw).into_iter().collect();
        }
        if text.starts_with("#ex-chr-conflict") {
            // Philly と同じ案内(PersonalThread.cpp:1353)
            return vec![message(
                Channel::System,
                "3重状態で消えています。移動してください".into(),
                None,
            )];
        }
        if let Some(mapset) = text.strip_prefix("#mapset ") {
            let mapset = mapset.trim().to_string();
            self.mapset = Some(mapset.clone());
            return vec![Event::Notice(Notice {
                mapset: Some(mapset),
                ..Default::default()
            })];
        }
        if let Some(rest) = text.strip_prefix("#mapset-define ") {
            let mut it = rest.split_whitespace();
            if let (Some(no), Some(mapset)) = (it.next().and_then(|n| n.parse::<u8>().ok()), it.next()) {
                return vec![Event::Notice(Notice {
                    mapset_define: Some((no % 4, mapset.to_string())),
                    ..Default::default()
                })];
            }
            return Vec::new();
        }
        if let Some(world) = text.strip_prefix("#ex-notice land=") {
            return vec![Event::Notice(Notice {
                world: Some(world.into()),
                ..Default::default()
            })];
        }
        if let Some(area) = text.strip_prefix("#ex-notice area=") {
            return vec![Event::Notice(Notice {
                area: Some(area.into()),
                ..Default::default()
            })];
        }
        if text.starts_with("#ex-pos ") {
            let parts: Vec<&str> = text.split_whitespace().collect();
            if parts.len() >= 3
                && let (Some(x), Some(y)) = (ascii_uint(parts[1]), ascii_uint(parts[2]))
            {
                self.abs_pos = Some(Pos { x, y });
            }
            return Vec::new();
        }
        if text.starts_with("#ch-srv ") {
            let parts: Vec<&str> = text.split_whitespace().collect();
            if parts.len() >= 3
                && let Some(port) = py_int(parts[2])
            {
                return vec![Event::WorldTransfer {
                    state: WorldTransferState::Start,
                    server: format!("{}:{port}", parts[1]),
                }];
            }
            return Vec::new();
        }
        // #bgm・#ex-map size= などの既知の行も、未知の行も無視する
        Vec::new()
    }

    /// モードを変え、変わった時だけ全項目の mode イベントを返す。
    fn set_mode(&mut self, f: impl FnOnce(&mut Mode)) -> Vec<Event> {
        let before = self.mode;
        f(&mut self.mode);
        if before == self.mode {
            Vec::new()
        } else {
            vec![Event::Mode(self.mode)]
        }
    }

    fn parse_user(&mut self, raw: &[u8]) -> Option<Event> {
        // raw[6..10] = 4桁の番号、raw[11..42] = 31バイトの名前
        if raw.len() < 42 {
            return None;
        }
        let no = std::str::from_utf8(&raw[6..10])
            .ok()
            .filter(|s| s.is_ascii())
            .and_then(py_int)?;
        let name = decode(&raw[11..42]).trim_end().to_string();
        if name.is_empty() {
            return None;
        }
        match self.ulist.iter_mut().find(|(n, _)| *n == name) {
            Some(entry) => entry.1 = no,
            None => self.ulist.push((name, no)),
        }
        let users = self
            .ulist
            .iter()
            .map(|(name, no)| User {
                key: format!("u{no}"),
                name: name.clone(),
            })
            .collect();
        Some(Event::UserList { users })
    }

    /// `#ex-obj S <幅> <高さ> <z> <表示名>`。表示名は `#m57 O` の名前欄と照合する。
    fn parse_ex_obj(&mut self, text: &str) {
        let parts = split_ws_max(text, 5);
        if parts.len() != 6 {
            return;
        }
        let (Some(w), Some(h), Some(z)) = (py_int(parts[2]), py_int(parts[3]), py_int(parts[4])) else {
            return;
        };
        let name = parts[5].trim();
        if name.is_empty() {
            return;
        }
        let magnify = Magnify { w, h, z };
        match self.name_magnify.iter_mut().find(|(n, _)| n == name) {
            Some(entry) => entry.1 = magnify,
            None => self.name_magnify.push((name.to_string(), magnify)),
        }
    }

    /// `#m57 M <向き> <時刻>:` の後、raw[18..116] に (chip, attr) が49組並ぶ。
    fn parse_m57_m(&mut self, raw: &[u8]) {
        if raw.len() > M57_DIRECTION_OFFSET {
            self.map_dir = dir_to_num(raw[M57_DIRECTION_OFFSET]);
        }
        let Some(chip) = raw.get(M57_CHIP_OFFSET..M57_CHIP_OFFSET + MAP_CHIP_BYTE) else {
            self.map_cells = None;
            return;
        };
        self.map_cells = Some(
            chip.as_chunks::<2>()
                .0
                .iter()
                .map(|&[chip, attr]| Cell { chip, attr })
                .collect(),
        );
    }

    /// `#m57 O` と `#v6 O` の固定位置の欄を読む。`head` は層の位置、`digits` は座標の桁数。
    ///
    /// `#m57 O`(head 7、1桁): [7]層 [8..12]ID(16進) [13]X [15]Y [17]向き [19..50]名前(cp932)
    /// [51..53]状態(16進) [54..69]グラ名(cp932) [70]Gigant [72..74]種別(16進)。
    /// `#v6 O`(head 6、2桁)は行の頭が1バイト短く、座標が1桁ずつ長いので、向きから後ろは1バイト後ろへずれる
    fn parse_m57_o(&mut self, raw: &[u8], head: usize, digits: usize) {
        // 向きの位置。ここから後ろの欄は #m57 O と #v6 O で同じ並び
        let t = head + 2 * digits + 8;
        if raw.len() < t + 57 {
            return;
        }
        let ascii = |r: std::ops::Range<usize>| std::str::from_utf8(&raw[r]).ok().filter(|s| s.is_ascii());
        let hex = |r| ascii(r).and_then(|s: &str| u32::from_str_radix(s.trim(), 16).ok());
        let dec = |i: usize| {
            ascii(i..i + digits)
                .filter(|s| s.bytes().all(|b| b.is_ascii_digit()))
                .and_then(|s| s.parse::<u8>().ok())
        };
        let (Some(layer), Some(id), Some(x), Some(y), Some(status), Some(default)) = (
            char::from(raw[head]).to_digit(16).map(|d| d as u8),
            hex(head + 1..head + 5),
            dec(head + 6),
            dec(head + 7 + digits),
            hex(t + 34..t + 36),
            hex(t + 55..t + 57),
        ) else {
            return;
        };
        let name = decode(&raw[t + 2..t + 33]).trim_end().to_string();
        let gra = decode(&raw[t + 37..t + 52]).trim_end().to_string();

        if self.chara_clear_pending {
            self.map_chars.clear();
            self.chara_clear_pending = false;
        }
        let magnify = self.name_magnify.iter().find(|(n, _)| *n == name).map(|&(_, m)| m);
        if self.map_chars.len() >= MAX_MAP_CHARS {
            return;
        }
        self.map_chars.push(Chara {
            id,
            x,
            y,
            dir: char::from(raw[t]),
            name,
            gra,
            status,
            gigant: char::from(raw[t + 53]),
            layer,
            default,
            magnify,
        });
    }

    fn finish_map(&mut self) -> Vec<Event> {
        let cells = self.map_cells.clone().unwrap_or_default();
        vec![Event::Map(self.build_map(7, 7, cells, false))]
    }

    fn build_map(&mut self, width: u8, height: u8, cells: Vec<Cell>, v6: bool) -> Map {
        // chars は次フレームの最初の O 行が来るまで残す
        self.chara_clear_pending = true;
        Map {
            width,
            height,
            dir: self.map_dir,
            cells,
            chars: self.map_chars.clone(),
            style: self.map_style.clone(),
            pos: self.abs_pos.take(),
            v6,
        }
    }

    /// `#v6 M (方角) (HEX時刻) W H`。6バイト目が方角
    fn parse_v6_m(&mut self, raw: &[u8], rest: &str) {
        let mut it = rest.split_whitespace().skip(2);
        let (Some(w), Some(h)) = (
            it.next().and_then(|s| s.parse::<u8>().ok()),
            it.next().and_then(|s| s.parse::<u8>().ok()),
        ) else {
            return;
        };
        self.map_dir = dir_to_num(raw[6]);
        self.v6_size = (w, h);
        self.v6_rows = vec![None; h as usize];
    }

    /// `#v6 R NN ` の9バイトの後に (chip, attr) が W 組並ぶ。NN は 10 進 2 桁の行番号で、0 が上の行
    fn parse_v6_r(&mut self, raw: &[u8]) {
        let w = self.v6_size.0 as usize;
        let row = std::str::from_utf8(&raw[6.min(raw.len())..8.min(raw.len())])
            .ok()
            .and_then(ascii_uint);
        let (Some(row), Some(chip)) = (row, raw.get(9..9 + w * 2)) else {
            return;
        };
        if let Some(slot) = self.v6_rows.get_mut(row as usize) {
            *slot = Some(chip.as_chunks::<2>().0.iter().map(|&[chip, attr]| Cell { chip, attr }).collect());
        }
    }

    /// `#v6 .`。行が揃っていなければ地図を返さず、UI は前の地図のまま描く
    fn finish_v6(&mut self) -> Vec<Event> {
        let rows = std::mem::take(&mut self.v6_rows);
        let (w, h) = self.v6_size;
        if rows.is_empty() || rows.iter().any(Option::is_none) {
            self.chara_clear_pending = true;
            self.abs_pos = None;
            return Vec::new();
        }
        let cells = rows.into_iter().flatten().flatten().collect();
        vec![Event::Map(self.build_map(w, h, cells, true))]
    }
}

fn message(channel: Channel, text: String, from: Option<String>) -> Event {
    let markup = text.contains("/*");
    Event::Message(Message {
        channel,
        text,
        from,
        markup,
    })
}

fn parse_status(text: &str) -> Status {
    let body = text["#status".len()..].trim_start();
    let parts: Vec<&str> = body.split(':').collect();
    let mut nums = [None; STATUS_KEYS];
    for (i, slot) in nums.iter_mut().enumerate() {
        *slot = parts.get(i + 1).and_then(|p| py_int(p));
    }
    let [hp, max_hp, mp, max_mp, exp, gp, f, w, m, c] = nums;
    let name = Some(parts[0].trim()).filter(|n| !n.is_empty()).map(str::to_string);
    Status {
        name,
        hp,
        max_hp,
        mp,
        max_mp,
        exp,
        gp,
        f,
        w,
        m,
        c,
    }
}

fn parse_cond(text: &str) -> Cond {
    let mut flags = [false; 7];
    for (slot, ch) in flags.iter_mut().zip(text.chars().skip(6).take(7)) {
        *slot = ch == '*';
    }
    let [poison, palsy, panic, confuse, berserk, silence, blind] = flags;
    Cond {
        poison,
        palsy,
        panic,
        confuse,
        berserk,
        silence,
        blind,
    }
}

/// 自キャラの向きの文字を N=0 から時計回りの数値にする。知らない文字は 0。
fn dir_to_num(b: u8) -> u8 {
    match b {
        b'E' => 2,
        b'S' => 4,
        b'W' => 6,
        _ => 0,
    }
}

/// Python の `int(s)` 相当(前後の空白を許す)。
fn py_int(s: &str) -> Option<i64> {
    s.trim().parse().ok()
}

/// Python の `s.isdigit()` が真の時だけ数値にする(ASCII の数字だけを扱う)。
fn ascii_uint(s: &str) -> Option<i64> {
    (!s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        .then(|| s.parse().ok())
        .flatten()
}

/// Python の `s.split(None, max)` 相当。最後の要素は残りをそのまま持つ。
fn split_ws_max(s: &str, max: usize) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = s.trim_start();
    while !rest.is_empty() && out.len() < max {
        match rest.find(char::is_whitespace) {
            Some(i) => {
                out.push(&rest[..i]);
                rest = rest[i..].trim_start();
            }
            None => {
                out.push(rest);
                rest = "";
            }
        }
    }
    if !rest.is_empty() {
        out.push(rest);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 看板の本文に書かれたコマンドを実行しない(Philly と同じ)
    #[test]
    fn mapset_define() {
        let mut p = Parser::new();
        assert_eq!(
            p.feed(b"#mapset-define 1 castle"),
            vec![Event::Notice(Notice {
                mapset_define: Some((1, "castle".into())),
                ..Default::default()
            })]
        );
        assert_eq!(
            p.feed(b"#mapset-define 6 default"),
            vec![Event::Notice(Notice {
                mapset_define: Some((2, "default".into())),
                ..Default::default()
            })]
        );
        assert!(p.feed(b"#mapset-define x").is_empty());
    }

    #[test]
    fn commands_inside_more_are_log() {
        let mut p = Parser::new();
        p.feed(b"#more");
        for line in [
            &b"#ch-srv 192.0.2.1 9000"[..],
            b"#x",
            b"[evil] > fake priv",
            b"#m57 M N 00:",
        ] {
            let evs = p.feed(line);
            assert!(
                matches!(
                    evs.as_slice(),
                    [Event::Message(Message {
                        channel: Channel::Log,
                        ..
                    })]
                ),
                "{evs:?}"
            );
        }
        assert_eq!(p.feed(b"#end-more"), vec![Event::Mode(Mode::default())]);
        assert!(matches!(
            p.feed(b"#ch-srv 192.0.2.1 9000").as_slice(),
            [Event::WorldTransfer { .. }]
        ));
    }

    /// v6 の地図の行(サーバの phi_dm の docs/dev/protocol-v6.md の書式)。マスは行番号をチップにする
    fn v6_frame(w: u8, h: u8, rows: impl IntoIterator<Item = u8>, chars: &[(u8, u8, &str)]) -> Vec<Vec<u8>> {
        let mut lines = vec![format!("#v6 M N 0000abcd {w} {h}").into_bytes()];
        for y in rows {
            let mut l = format!("#v6 R {y:02} ").into_bytes();
            for _ in 0..w {
                l.extend([b'0' + y, 0]);
            }
            lines.push(l);
        }
        for (i, &(x, y, name)) in chars.iter().enumerate() {
            lines.push(format!("#v6 O C{i:04x}:{x:02} {y:02} F {name:<31} 00 {:<15} # 01 ", "t_man").into_bytes());
        }
        lines.push(b"#v6 .".to_vec());
        lines
    }

    fn feed_all(p: &mut Parser, lines: Vec<Vec<u8>>) -> Vec<Event> {
        lines.iter().flat_map(|l| p.feed(l)).collect()
    }

    fn only_map(evs: Vec<Event>) -> Map {
        match evs.as_slice() {
            [Event::Map(m)] => m.clone(),
            _ => panic!("{evs:?}"),
        }
    }

    #[test]
    fn v6_solid_9x9() {
        let mut p = Parser::new();
        let m = only_map(feed_all(&mut p, v6_frame(9, 9, 0..9, &[(4, 4, "me")])));
        assert_eq!((m.width, m.height, m.dir, m.v6), (9, 9, 0, true));
        assert_eq!(m.cells.len(), 81);
        assert_eq!(m.cells[0], Cell { chip: b'0', attr: 0 });
        assert_eq!(m.cells[80], Cell { chip: b'8', attr: 0 });
        let c = &m.chars[0];
        assert_eq!((c.x, c.y, c.dir, c.name.as_str(), c.gra.as_str(), c.layer, c.default), (4, 4, 'F', "me", "t_man", 12, 1));
        // UI は v6 の印で予想を使うか決める(#m57 の地図には付けない)
        assert_eq!(serde_json::to_value(&m).unwrap()["v6"], true);
    }

    #[test]
    fn v6_coordinates_of_10_or_more() {
        let mut p = Parser::new();
        let m = only_map(feed_all(&mut p, v6_frame(21, 21, 0..21, &[(10, 10, "me"), (20, 13, "far")])));
        assert_eq!(m.chars.iter().map(|c| (c.x, c.y)).collect::<Vec<_>>(), [(10, 10), (20, 13)]);
    }

    #[test]
    fn v6_missing_rows_keep_previous_map() {
        let mut p = Parser::new();
        assert!(feed_all(&mut p, v6_frame(9, 9, (0..9).filter(|&y| y != 5), &[(4, 4, "me")])).is_empty());
        // 次の地図はまた揃えば届き、前の地図のキャラは残さない
        let m = only_map(feed_all(&mut p, v6_frame(9, 9, 0..9, &[(3, 4, "next")])));
        assert_eq!(m.chars.len(), 1);
        assert_eq!(m.chars[0].name, "next");
    }

    #[test]
    fn v6_wide_map() {
        let mut p = Parser::new();
        let m = only_map(feed_all(&mut p, v6_frame(11, 7, 0..7, &[(5, 3, "me")])));
        assert_eq!((m.width, m.height, m.cells.len()), (11, 7, 77));
        assert_eq!(m.cells[11], Cell { chip: b'1', attr: 0 });
        assert_eq!((m.chars[0].x, m.chars[0].y), (5, 3));
    }
}
