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
/// EagleEye の幅と高さの上限。行の頭の幅と行番号は 10 進 2 桁なので 99 まで。
/// v6 の接続は 65x49 で届く(docs/05-protocol-v6.md)
const MAX_EAGLE_EYE_COUNT: usize = 99;

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
    /// `#v6 G dx dy [語]`。v6 のサーバが go のたびに地図より先に送る、動いた差(東と南が正)。進めなかった時は 0 0。
    /// 語は進めなかった理由(wall lock edge chr obj bind palsy busy)か、押して進んだ push。古いサーバは付けない
    /// (phi_dm の docs/dev/protocol-v6.md の「移動の返事」)
    Moved {
        dx: i32,
        dy: i32,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    /// `#v6 J`。go 以外(スイッチ・ゲート・罠など)で動いた。予想と覚えた通れる・通れないを捨てる
    Jumped,
    /// `#ex-inv F` 〜 `#ex-inv F .`。`#ex-inv floor` への返事で、足元の物 (#189)。番号は `#ex-inv pick` と同じ数え方
    Floor {
        items: Vec<FloorItem>,
    },
    /// `#v6 B` 〜 `#v6 B .`。乗ったマスの売り場の品と値段 (#187)。gp が値段。空なら売り場から離れた
    Shop {
        items: Vec<FloorItem>,
    },
    /// `#v6 K` 〜 `#v6 K .`。`#ex-talk` への返事で、足元か目の前の NPC に言える言葉 (#188)
    TalkWords {
        words: Vec<TalkWord>,
    },
    /// `#v6 L 名前<TAB>dx=<TAB>dy=` 〜 `#v6 L .`。GM が置いた自分の階の目印までの差 (#191)。空なら目印は無い
    Marks {
        marks: Vec<Mark>,
    },
    /// `#v6 Y ask C%04x 名前`。取引の申し込みを受けた (#192)
    TradeAsk {
        id: u32,
        name: String,
    },
    /// `#v6 Y with` 〜 `#v6 Y .`。取引の両方の出す物 (#192)
    Trade {
        id: u32,
        name: String,
        me: TradeSide,
        you: TradeSide,
    },
    /// `#v6 Y done` (入れ替えた) か `#v6 Y end 理由`。取引の終わり
    TradeEnd {
        reason: String,
    },
    /// `#ex-trade no 理由`。取引の操作を断られた
    TradeRefused {
        reason: String,
    },
    /// `#v6 Q 番号<TAB>kind=<TAB>title=<TAB>text=` 〜 `#v6 Q .`。今出ている依頼と、その今の段階の目的 (#193)
    Quests {
        quests: Vec<Quest>,
    },
    /// `#v6 W`。詠唱 (cast) と攻撃の待ち (at) の長さ (0.1 秒単位)。ticks が None なら止まった。
    /// who は周りのキャラの番号 (#v6 O の C%04x)、自分なら None。spell は自分の詠唱の呪文の番号 (#v6 S の番号) (#185)
    Wait {
        #[serde(skip_serializing_if = "Option::is_none")]
        who: Option<u32>,
        kind: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        ticks: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        spell: Option<u32>,
    },
    /// `#v6 H C%04x hp=<0-100> ag=<0|1>[ merc=1][ low=1]`。視界のキャラの HP の割合と、自分か仲間を狙っているか (#184)。
    /// merc は傭兵 (DM の phi.ed の :O F) か。自動攻撃の対象にしない。
    /// low はカルマ 50 未満の NPC (町の人など) か。設定で自動攻撃の対象から外す
    CharHp {
        id: u32,
        hp: u8,
        ag: bool,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        merc: bool,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        low: bool,
    },
    /// `#ex-switch move=diag` の返事。この接続では斜めの 1 歩を `go ne` などの 1 行で送れる (#196)
    MoveDiag,
    /// `#end-mg`。呪文の一覧か詠唱が終わった。詠唱の終わりを UI が知る為に、mode が変わらなくても送る
    CastEnd,
    /// `#v6 E 種類 AX AY TX TY [属性 [分類]]`。攻撃と呪文の演出の位置(視界の座標。`#v6 O` と同じ)。戦闘のログの行の直前に届く。
    /// 種類は chant(詠唱の始め。両方の座標が唱えた人)・hit・miss・magic・spell。攻撃した側が視界の外なら from は None。
    /// 属性は武器か呪文の属性 (fire など)。分類は呪文の演出の分け方 (line・explode・heal など。DM の魔法の表示オブジェと同じ)。
    /// 送らないサーバと `-` は None(phi_dm の docs/dev/protocol-v6.md の「演出の位置」)
    Effect {
        kind: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        from: Option<Pos>,
        at: Pos,
        #[serde(skip_serializing_if = "Option::is_none")]
        element: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        category: Option<String>,
        /// chant の詠唱の長さ (0.1 秒単位)。送らないサーバでは None
        #[serde(skip_serializing_if = "Option::is_none")]
        wait: Option<u32>,
    },
    /// `#v6 S` 〜 `#v6 S .`。覚えている呪文を cast の番号の順に(phi_dm の docs/dev/protocol-v6.md の「呪文・持ち物・カバン」)
    Spells {
        spells: Vec<Spell>,
    },
    /// `#v6 Z` 〜 `#v6 Z .`。持っている武器で出せる技 (phidm-v6 の phi_skill.rs)。武器を持ち替えた時に届く
    Skills {
        skills: Vec<Skill>,
    },
    /// `#v6 W skill=番号 cd=待ち gcd=共通の待ち`。技が出て、その技の待ちと、どの技にも掛かる共通の待ちに入った (0.1 秒単位)
    SkillWait {
        no: u32,
        cd: u32,
        gcd: u32,
    },
    /// `#ex-skill no wait=待ち` / `reason=`。技の予約を断られた。wait は残りの待ち (0.1 秒単位)
    SkillRefused {
        #[serde(skip_serializing_if = "Option::is_none")]
        wait: Option<u32>,
    },
    /// `#v6 I` 〜 `#v6 I .`。手持ちの 8 個。空いた枠は None(phi_dm の docs/dev/protocol-v6.md の「呪文・持ち物・カバン」)
    Items {
        items: Vec<Option<Item>>,
    },
    /// `#v6 P` 〜 `#v6 P .`。自分を先頭にした仲間の一覧。パーティに入っていなければ空
    /// (phi_dm の docs/dev/protocol-v6.md の「仲間の一覧」)
    Party {
        members: Vec<PartyMember>,
    },
    /// `#ex-inv I` 〜 `#ex-inv .`。インベントリ(預かり所)の中身。名前の順で、取り出す番号は 1 から
    Bag {
        items: Vec<Item>,
    },
    /// `#ex-inv no 理由`。インベントリの出し入れが出来なかった
    BagRefused {
        reason: String,
    },
}

/// 目印 1 つ (`#v6 L` の欄)。自分からの差 (東と南が正)
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Mark {
    pub name: String,
    pub dx: i32,
    pub dy: i32,
}

/// 取引の片方の出す物 (`#v6 Y me` / `you`)
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct TradeSide {
    pub gp: i64,
    pub ok: bool,
    pub items: Vec<TradeItem>,
}

/// 取引に出した物 1 つ。from は出した所 (`put 枠` か `bag 番号`)。同じ行を送り直すと引っ込める
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TradeItem {
    pub from: String,
    pub item: Item,
}

/// 依頼 1 つ (`#v6 Q` の欄)
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Quest {
    pub no: u32,
    /// main・sub・daily。kind の無い DM (種類を足す前の版) からは sub
    pub kind: String,
    pub title: String,
    pub text: String,
}

/// NPC に言える言葉 1 つ (`#v6 K` の欄)。menu はスイッチのメニューの選択で、`?` を付けずにそのまま送る
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TalkWord {
    pub word: String,
    pub menu: bool,
}

/// 足元の物 1 つ (`#ex-inv F` の欄)。お金なら gp だけで item は無い
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FloorItem {
    pub no: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item: Option<Item>,
}

/// 仲間 1 人(`#v6 P` の欄。Party eye と同じ情報に HP・MP・状態異常を足した物)
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartyMember {
    /// サーバのキャラ番号
    pub no: i64,
    /// タグを除いた名前と、タグの色を付けた HTML
    pub name: String,
    pub html: String,
    pub area: String,
    /// 自分から見た位置の差(東と南が正)。階が違えば None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dx: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dy: Option<i32>,
    /// 放置の秒数と、遅延(0.1 秒単位。分からなければ None)
    pub idle: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lag: Option<i64>,
    pub hp: i64,
    pub mhp: i64,
    pub mp: i64,
    pub mmp: i64,
    pub cond: Cond,
}

/// 覚えている呪文 1 つ(`#v6 S` の欄)
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Spell {
    /// cast で選ぶ番号 (1 から)。唱えると入れ替わる
    pub no: i64,
    /// 呪文。タグを除いた物
    pub name: String,
    /// タグの色を付けた HTML
    pub html: String,
    /// 効果 (EF_*)
    pub ef: i32,
    /// 属性 (FN_*)
    #[serde(rename = "fn")]
    pub fn_: i8,
}

/// 武器の技 1 つ (`#v6 Z` の欄)
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// `#ex-skill` で送る番号 (1 から)
    pub no: u32,
    pub name: String,
    /// 並びの手数
    pub len: u32,
    /// 上がるダメージ (%)
    pub bonus: u32,
    /// 使った後の待ち (0.1 秒単位)
    pub cd: u32,
    /// 届いた時の残りの待ち (0.1 秒単位)
    pub left: u32,
}

/// `#v6 Z 番号<TAB>name=<TAB>len=<TAB>bonus=<TAB>cd=<TAB>left=` の番号の後ろを読む
fn parse_skill(no: u32, fields: &str) -> Skill {
    let mut sk = Skill {
        no,
        ..Default::default()
    };
    for f in fields.split('\t') {
        let Some((k, v)) = f.split_once('=') else { continue };
        let num = || v.trim().parse().unwrap_or(0);
        match k {
            "name" => sk.name = strip_tags(v),
            "len" => sk.len = num(),
            "bonus" => sk.bonus = num(),
            "cd" => sk.cd = num(),
            "left" => sk.left = num(),
            _ => {}
        }
    }
    sk
}

/// `#v6 S` の番号の後ろの欄(タブで区切った キー=値)を読む
fn parse_spell(no: i64, fields: &str) -> Spell {
    let mut sp = Spell {
        no,
        name: String::new(),
        html: String::new(),
        ef: 0,
        fn_: 0,
    };
    for f in fields.split('\t') {
        let Some((k, v)) = f.split_once('=') else { continue };
        match k {
            "ef" => sp.ef = v.trim().parse().unwrap_or(0),
            "fn" => sp.fn_ = v.trim().parse().unwrap_or(0),
            "name" => {
                sp.name = strip_tags(v);
                sp.html = crate::tag_to_html::to_html(v, &crate::tag_to_html::LogOptions::default());
            }
            _ => {}
        }
    }
    sp
}

/// 持ち物 1 個(`#v6 I` と `#ex-inv I` の欄)
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// 装備の印。W 武器、A 防具、O その他、- 無し
    pub eq: String,
    /// 用途(IT_*)、武器の種類(WT_*)、材質(MT_*)、属性(FN_*)の番号
    pub it: u8,
    pub wt: u8,
    pub mt: u8,
    #[serde(rename = "fn")]
    pub fn_: i8,
    pub wp: i32,
    pub op: [i32; 4],
    /// チャージアイテムの残りの回数
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<i32>,
    /// 使えるまでの秒数(送った時点)
    pub ready: i64,
    /// 世界の names/*.h の名前
    #[serde(rename = "type")]
    pub type_name: String,
    pub wtype: String,
    pub mat: String,
    pub elem: String,
    /// op[2] の効果の名前(武器・資源・呪文の宝石・チャージ・アクセサリーだけ)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effect: Option<String>,
    /// op[3] の特殊効果(S.E.)の名前。curse は持ち主に呪いとして効く物
    #[serde(skip_serializing_if = "Option::is_none")]
    pub se: Option<String>,
    pub curse: bool,
    /// 名前。タグ(`/*color=red*/` など)を除いた物で、探す時と説明の文に使う
    pub name: String,
    /// 名前をタグの色と大きさを付けた HTML にした物(ログの行と同じ作り)。画面に出す
    pub html: String,
    /// サーバが送ったままの名前(タグを含む)。equip のように名前で指すコマンドに使う
    pub raw_name: String,
}

/// タグ(`/*…*/`)を除く
fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find("/*") {
        out.push_str(&rest[..i]);
        match rest[i + 2..].find("*/") {
            Some(j) => rest = &rest[i + 2 + j + 2..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

/// `#v6 W` の欄。`[C%04x] cast=<ティック>|stop [呪文の番号]` か `at=<ティック>`
fn parse_wait(rest: &str) -> Option<Event> {
    // 技の待ち `skill=番号 cd=待ち`
    if rest.starts_with("skill=") {
        let mut f = rest.split_whitespace();
        let no = f.next()?.strip_prefix("skill=")?.parse().ok()?;
        let (mut cd, mut gcd) = (0, 0);
        for kv in f {
            match kv.split_once('=') {
                Some(("cd", v)) => cd = v.parse().unwrap_or(0),
                Some(("gcd", v)) => gcd = v.parse().unwrap_or(0),
                _ => {}
            }
        }
        return Some(Event::SkillWait { no, cd, gcd });
    }
    let mut f = rest.split_whitespace().peekable();
    let who = match f.peek() {
        Some(w) if w.starts_with('C') => {
            let w = f.next()?;
            Some(u32::from_str_radix(&w[1..], 16).ok()?)
        }
        _ => None,
    };
    let (kind, v) = f.next()?.split_once('=')?;
    let ticks = if v == "stop" { None } else { Some(v.parse().ok()?) };
    let spell = f.next().and_then(|s| s.parse().ok());
    Some(Event::Wait {
        who,
        kind: kind.to_string(),
        ticks,
        spell,
    })
}

/// `#v6 H` の欄。`C%04x hp=<0-100> ag=<0|1>[ merc=1][ low=1]`
fn parse_char_hp(rest: &str) -> Option<Event> {
    let mut f = rest.split_whitespace();
    let id = u32::from_str_radix(f.next()?.strip_prefix('C')?, 16).ok()?;
    let (mut hp, mut ag, mut merc, mut low) = (None, false, false, false);
    for kv in f {
        match kv.split_once('=') {
            Some(("hp", v)) => hp = v.parse().ok(),
            Some(("ag", v)) => ag = v == "1",
            Some(("merc", v)) => merc = v == "1",
            Some(("low", v)) => low = v == "1",
            _ => {}
        }
    }
    Some(Event::CharHp {
        id,
        hp: hp?,
        ag,
        merc,
        low,
    })
}

/// `#v6 E` の欄。座標は 2 桁の数か、視界の外なら `--`。受けた側が読めなければ捨てる
fn parse_effect(rest: &str) -> Option<Event> {
    let f: Vec<&str> = rest.split_whitespace().collect();
    let [kind, ax, ay, tx, ty, ref more @ ..] = f[..] else {
        return None;
    };
    let pos = |x: &str, y: &str| {
        Some(Pos {
            x: x.parse().ok()?,
            y: y.parse().ok()?,
        })
    };
    Some(Event::Effect {
        kind: kind.to_string(),
        from: pos(ax, ay),
        at: pos(tx, ty)?,
        element: more.first().filter(|e| **e != "-").map(|e| e.to_string()),
        category: more.get(1).filter(|e| **e != "-").map(|e| e.to_string()),
        wait: more.get(2).and_then(|w| w.parse().ok()),
    })
}

/// `#v6 I` / `#ex-inv I` の番号の後ろの欄(タブで区切った キー=値)を読む
fn parse_item(fields: &str) -> Item {
    let mut it = Item::default();
    for f in fields.split('\t') {
        let Some((k, v)) = f.split_once('=') else { continue };
        let num = || v.trim().parse::<i64>().unwrap_or(0);
        match k {
            "eq" => it.eq = v.to_string(),
            "it" => it.it = num() as u8,
            "wt" => it.wt = num() as u8,
            "mt" => it.mt = num() as u8,
            "fn" => it.fn_ = num() as i8,
            "wp" => it.wp = num() as i32,
            "op" => {
                for (o, x) in it.op.iter_mut().zip(v.split(',')) {
                    *o = x.trim().parse().unwrap_or(0);
                }
            }
            "count" => it.count = Some(num() as i32),
            "ready" => it.ready = num(),
            "type" => it.type_name = v.to_string(),
            "wtype" => it.wtype = v.to_string(),
            "mat" => it.mat = v.to_string(),
            "elem" => it.elem = v.to_string(),
            "effect" => it.effect = Some(v.to_string()),
            "se" => it.se = Some(v.to_string()),
            "curse" => it.curse = v == "1",
            "name" => {
                it.name = strip_tags(v);
                it.raw_name = v.to_string();
                it.html = crate::tag_to_html::to_html(v, &crate::tag_to_html::LogOptions::default());
            }
            _ => {}
        }
    }
    it
}

/// `#v6 P` の番号の後ろの欄(タブで区切った キー=値)を読む
fn parse_party_member(no: i64, fields: &str) -> PartyMember {
    let mut m = PartyMember {
        no,
        ..Default::default()
    };
    for f in fields.split('\t') {
        let Some((k, v)) = f.split_once('=') else { continue };
        let num = || v.trim().parse::<i64>().unwrap_or(0);
        match k {
            "name" => {
                m.name = strip_tags(v);
                m.html = crate::tag_to_html::to_html(v, &crate::tag_to_html::LogOptions::default());
            }
            "area" => m.area = strip_tags(v),
            "dx" => m.dx = Some(num() as i32),
            "dy" => m.dy = Some(num() as i32),
            "idle" => m.idle = num(),
            "lag" => m.lag = Some(num()),
            "hp" => m.hp = num(),
            "mhp" => m.mhp = num(),
            "mp" => m.mp = num(),
            "mmp" => m.mmp = num(),
            "cond" => m.cond = cond_flags(v),
            _ => {}
        }
    }
    m
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
    /// 仲間だけへの発言(`"名前" > 本文`。サーバの TLK_PARTY)。
    Party,
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
    /// 発言の種類 (直前の `#v6 T`。say shout area party npc switch)。送らないサーバでは None (#190)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize)]
pub struct Cell {
    pub chip: u8,
    pub attr: u8,
    /// 見た目と違って通れない(`#v6 X`)。自キャラの周りだけサーバが付ける
    #[serde(skip_serializing_if = "is_false")]
    pub blocked: bool,
    /// マップセットの枠 1〜15(`#v6 A`)。無ければ属性の下位 2 ビット(枠 0〜3)で描く
    #[serde(skip_serializing_if = "Option::is_none")]
    pub set: Option<u8>,
}

fn is_false(b: &bool) -> bool {
    !*b
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
    /// `MAX_EAGLE_EYE_COUNT` 四方を行優先で並べる
    grid: Vec<Cell>,
    size_x: i64,
    size_y: i64,
    /// `#ex-eagleeye pos` の位置。サーバは送らないので、無ければ盤面の中央にする
    pos: Option<Pos>,
}

impl Default for EagleEyeAccum {
    fn default() -> Self {
        Self {
            grid: vec![Cell::default(); MAX_EAGLE_EYE_COUNT * MAX_EAGLE_EYE_COUNT],
            size_x: 0,
            size_y: 0,
            pos: None,
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
            self.grid[y as usize * MAX_EAGLE_EYE_COUNT + x] = Cell {
                chip: raw[i],
                attr: raw[i + 1],
                ..Default::default()
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
        let pos = self.pos.get_or_insert(Pos { x: 0, y: 0 });
        pos.x = x;
        let Some(y) = py_int(parts[3]) else { return };
        pos.y = y;
    }

    fn build(&self, mapset: Option<String>) -> EagleEye {
        let (w, h) = (self.size_x.max(0) as usize, self.size_y.max(0) as usize);
        let cells = (0..h)
            .flat_map(|y| (0..w).map(move |x| (y, x)))
            .map(|(y, x)| self.grid[y * MAX_EAGLE_EYE_COUNT + x])
            .collect();
        EagleEye {
            width: self.size_x,
            height: self.size_y,
            // サーバは自キャラを中央 (幅/2, 高さ/2) に置く
            self_pos: self.pos.unwrap_or(Pos {
                x: self.size_x / 2,
                y: self.size_y / 2,
            }),
            cells,
            mapset,
        }
    }
}

/// リストの行の上限。実際のリストは数十行。
/// 終わりの行が来るまで貯める一覧の行数の上限にも使う。カバン・仲間・ユーザ・名前の倍率にも使う (#129)
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

    /// `#v6 I` で届いた手持ちの枠(`#v6 I .` で Items にする)と、`#ex-inv I` で届いたインベントリの中身
    items: Vec<Option<Item>>,
    bag: Vec<Item>,
    /// `#v6 P` で届いた仲間(`#v6 P .` で Party にする)
    party: Vec<PartyMember>,
    /// `#v6 S` で届いた呪文。`#v6 S .` で Spells にする
    spells: Vec<Spell>,
    /// `#v6 Z` で届いた技。`#v6 Z .` で Skills にする
    skills: Vec<Skill>,
    /// `#v6 M` の幅と高さと、届いた `#v6 R` の行(行番号の位置)。`#v6 .` で全部揃っていれば地図にする
    v6_size: (u8, u8),
    v6_rows: Vec<Option<Vec<Cell>>>,
    /// `#v6 X` で通れないと届いたマス (行, 列)。`#v6 .` で地図のマスに写す
    v6_blocked: Vec<(usize, usize)>,
    /// `#v6 A` で届いたマスのマップセットの枠 (行, 列, 枠)。`#v6 .` で地図のマスに写す
    v6_sets: Vec<(usize, usize, u8)>,
    /// `#ex-inv F` で受けている途中の足元の物
    floor: Vec<FloorItem>,
    /// `#v6 B` で受けている途中の売り場の品 (#187)
    shop: Vec<FloorItem>,
    /// `#v6 K` で受けている途中の NPC に言える言葉 (#188)
    talk: Vec<TalkWord>,
    /// 直前の `#v6 T` の発言の種類。次の 1 行に付ける (#190)
    speech: Option<String>,
    /// `#v6 L`・`#v6 Y`・`#v6 Q` で受けている途中の物
    marks: Vec<Mark>,
    trade: Option<(u32, String, TradeSide, TradeSide)>,
    quests: Vec<Quest>,

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

    /// v6 の地図 (`#v6 M`) を受けたか
    pub fn has_v6_map(&self) -> bool {
        self.v6_size != (0, 0)
    }

    /// `#user` で届いた名前のユーザ番号。priv の宛先を決める為に使う。
    pub fn user_no(&self, name: &str) -> Option<i64> {
        self.ulist.iter().find(|(n, _)| n == name).map(|&(_, no)| no)
    }

    pub fn feed(&mut self, raw: &[u8]) -> Vec<Event> {
        // #v6 T は次の 1 行の発言の種類。次の行が発言でなくても、そこで捨てる (#190)
        if let Some(rest) = raw.strip_prefix(b"#v6 T ") {
            self.speech = String::from_utf8_lossy(rest)
                .split_whitespace()
                .next()
                .map(str::to_string);
            return Vec::new();
        }
        let speech = self.speech.take();
        let mut events = self.feed_line(raw);
        if let Some(k) = speech {
            for ev in &mut events {
                if let Event::Message(m) = ev {
                    m.speech = Some(k.clone());
                }
            }
        }
        events
    }

    fn feed_line(&mut self, raw: &[u8]) -> Vec<Event> {
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
            if raw.starts_with(b"#v6 X ") {
                self.parse_v6_x(raw);
                return Vec::new();
            }
            if raw.starts_with(b"#v6 A ") {
                self.parse_v6_a(raw);
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
        // "\"名前\" > 本文" はパーティの発言
        if raw[0] == b'"'
            && let Some(end) = text[1..].find("\" > ").map(|e| e + 1)
        {
            let from = strip_tags(&text[1..end]);
            return vec![message(Channel::Party, text, Some(from))];
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
            "#end-mg" => {
                // 詠唱の終わりも #end-mg で届く。呪文の一覧を出していなければ mode は変わらないので、CastEnd を必ず送る
                let mut v = self.set_mode(|m| m.magic = false);
                v.push(Event::CastEnd);
                return v;
            }
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
        if let Some(rest) = text.strip_prefix("#v6 S ") {
            if rest.trim() == "." {
                return vec![Event::Spells {
                    spells: std::mem::take(&mut self.spells),
                }];
            }
            let (no, fields) = rest.split_once('\t').unwrap_or((rest, ""));
            if let Ok(no) = no.trim().parse::<i64>()
                && self.spells.len() < MAX_LIST_LINES
            {
                self.spells.push(parse_spell(no, fields));
            }
            return Vec::new();
        }
        if let Some(rest) = text.strip_prefix("#v6 Z ") {
            if rest.trim() == "." {
                return vec![Event::Skills {
                    skills: std::mem::take(&mut self.skills),
                }];
            }
            let (no, fields) = rest.split_once('\t').unwrap_or((rest, ""));
            if let Ok(no) = no.trim().parse::<u32>()
                && self.skills.len() < MAX_LIST_LINES
            {
                self.skills.push(parse_skill(no, fields));
            }
            return Vec::new();
        }
        if let Some(rest) = text.strip_prefix("#ex-skill no") {
            let wait = rest
                .split_whitespace()
                .find_map(|kv| kv.strip_prefix("wait="))
                .and_then(|v| v.parse().ok());
            return vec![Event::SkillRefused { wait }];
        }
        if text.starts_with("#ex-skill ok") {
            return Vec::new();
        }
        if let Some(rest) = text.strip_prefix("#v6 P ") {
            if rest.trim() == "." {
                return vec![Event::Party {
                    members: std::mem::take(&mut self.party),
                }];
            }
            let (no, fields) = rest.split_once('\t').unwrap_or((rest, ""));
            if let Ok(no) = no.trim().parse::<i64>()
                && self.party.len() < MAX_LIST_LINES
            {
                self.party.push(parse_party_member(no, fields));
            }
            return Vec::new();
        }
        if let Some(rest) = text.strip_prefix("#v6 I ") {
            if rest.trim() == "." {
                return vec![Event::Items {
                    items: std::mem::take(&mut self.items),
                }];
            }
            let (no, fields) = rest.split_once('\t').unwrap_or((rest, ""));
            if let Ok(no) = no.trim().parse::<usize>()
                && (1..=99).contains(&no)
            {
                if self.items.len() < no {
                    self.items.resize(no, None);
                }
                self.items[no - 1] = (!fields.is_empty()).then(|| parse_item(fields));
            }
            return Vec::new();
        }
        if let Some(rest) = text.strip_prefix("#ex-inv ") {
            if rest.trim() == "." {
                return vec![Event::Bag {
                    items: std::mem::take(&mut self.bag),
                }];
            }
            if let Some(reason) = rest.strip_prefix("no ") {
                self.bag.clear();
                return vec![Event::BagRefused {
                    reason: reason.trim().to_string(),
                }];
            }
            if let Some((_, fields)) = rest.strip_prefix("I ").and_then(|r| r.split_once('\t'))
                && self.bag.len() < MAX_LIST_LINES
            {
                self.bag.push(parse_item(fields));
            }
            if let Some(f) = rest.strip_prefix("F ") {
                if f.trim() == "." {
                    return vec![Event::Floor {
                        items: std::mem::take(&mut self.floor),
                    }];
                }
                if let Some((no, fields)) = f.split_once('\t')
                    && let Ok(no) = no.trim().parse()
                    && self.floor.len() < MAX_LIST_LINES
                {
                    let gp = fields.strip_prefix("gp=").and_then(|v| v.trim().parse().ok());
                    let item = gp.is_none().then(|| parse_item(fields));
                    self.floor.push(FloorItem { no, gp, item });
                }
            }
            return Vec::new();
        }
        if let Some(rest) = text.strip_prefix("#v6 G ") {
            let mut it = rest.split_whitespace();
            let mut num = || it.next().and_then(|s| s.parse::<i32>().ok());
            let (dx, dy) = (num(), num());
            let reason = rest.split_whitespace().nth(2).map(str::to_string);
            return match (dx, dy) {
                (Some(dx), Some(dy)) => vec![Event::Moved { dx, dy, reason }],
                _ => Vec::new(),
            };
        }
        if text.trim_end() == "#v6 J" {
            return vec![Event::Jumped];
        }
        if text.trim_end() == "#ex-switch move=diag" {
            return vec![Event::MoveDiag];
        }
        if let Some(rest) = text.strip_prefix("#v6 L ") {
            if rest.trim() == "." {
                return vec![Event::Marks {
                    marks: std::mem::take(&mut self.marks),
                }];
            }
            let (name, fields) = rest.split_once('\t').unwrap_or((rest, ""));
            let num = |k: &str| {
                fields
                    .split('\t')
                    .find_map(|f| f.strip_prefix(k))
                    .and_then(|v| v.trim().parse().ok())
            };
            if let (Some(dx), Some(dy)) = (num("dx="), num("dy="))
                && self.marks.len() < MAX_LIST_LINES
            {
                self.marks.push(Mark {
                    name: name.trim().to_string(),
                    dx,
                    dy,
                });
            }
            return Vec::new();
        }
        if let Some(rest) = text.strip_prefix("#v6 Q ") {
            if rest.trim() == "." {
                return vec![Event::Quests {
                    quests: std::mem::take(&mut self.quests),
                }];
            }
            let (no, fields) = rest.split_once('\t').unwrap_or((rest, ""));
            let field = |k: &str| {
                fields
                    .split('\t')
                    .find_map(|f| f.strip_prefix(k))
                    .unwrap_or("")
                    .to_string()
            };
            if let Ok(no) = no.trim().parse()
                && self.quests.len() < MAX_LIST_LINES
            {
                self.quests.push(Quest {
                    no,
                    kind: Some(field("kind="))
                        .filter(|k| !k.is_empty())
                        .unwrap_or_else(|| "sub".into()),
                    title: field("title="),
                    text: field("text="),
                });
            }
            return Vec::new();
        }
        if let Some(rest) = text.strip_prefix("#ex-trade no ") {
            return vec![Event::TradeRefused {
                reason: rest.trim().to_string(),
            }];
        }
        if let Some(rest) = text.strip_prefix("#v6 Y ") {
            return self.parse_trade(rest).into_iter().collect();
        }
        if let Some(rest) = text.strip_prefix("#v6 B ") {
            if rest.trim() == "." {
                return vec![Event::Shop {
                    items: std::mem::take(&mut self.shop),
                }];
            }
            if let Some((no, fields)) = rest.split_once('\t')
                && let Ok(no) = no.trim().parse()
                && self.shop.len() < MAX_LIST_LINES
            {
                let gp = fields
                    .split('\t')
                    .find_map(|f| f.strip_prefix("gp="))
                    .and_then(|v| v.trim().parse().ok());
                self.shop.push(FloorItem {
                    no,
                    gp,
                    item: Some(parse_item(fields)),
                });
            }
            return Vec::new();
        }
        if let Some(rest) = text.strip_prefix("#v6 K ") {
            if rest.trim() == "." {
                return vec![Event::TalkWords {
                    words: std::mem::take(&mut self.talk),
                }];
            }
            if self.talk.len() < MAX_LIST_LINES {
                let (word, tail) = rest.split_once('\t').unwrap_or((rest, ""));
                self.talk.push(TalkWord {
                    word: word.trim().to_string(),
                    menu: tail.trim() == "menu",
                });
            }
            return Vec::new();
        }
        if let Some(rest) = text.strip_prefix("#v6 W ") {
            return parse_wait(rest).into_iter().collect();
        }
        if let Some(rest) = text.strip_prefix("#v6 H ") {
            return parse_char_hp(rest).into_iter().collect();
        }
        if let Some(rest) = text.strip_prefix("#v6 E ") {
            return parse_effect(rest).into_iter().collect();
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
        // `#v6 D n 名前`。v6 の 16 枠のマップセット (phi_dm の docs/dev/protocol-v6.md)。枠 0 は `#mapset`
        if let Some(rest) = text.strip_prefix("#v6 D ") {
            let mut it = rest.split_whitespace();
            if let (Some(no), Some(mapset)) = (
                it.next()
                    .and_then(|n| n.parse::<u8>().ok())
                    .filter(|n| (1..16).contains(n)),
                it.next(),
            ) {
                return vec![Event::Notice(Notice {
                    mapset_define: Some((no, mapset.to_string())),
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
    /// `#v6 Y` の 1 行 (#192)
    fn parse_trade(&mut self, rest: &str) -> Option<Event> {
        let id_name = |r: &str| {
            let (id, name) = r.trim().split_once(' ').unwrap_or((r.trim(), ""));
            Some((
                u32::from_str_radix(id.strip_prefix('C')?, 16).ok()?,
                name.trim().to_string(),
            ))
        };
        if let Some(r) = rest.strip_prefix("ask ") {
            let (id, name) = id_name(r)?;
            return Some(Event::TradeAsk { id, name });
        }
        if let Some(r) = rest.strip_prefix("with ") {
            let (id, name) = id_name(r)?;
            self.trade = Some((id, name, TradeSide::default(), TradeSide::default()));
            return None;
        }
        if rest.trim() == "done" {
            self.trade = None;
            return Some(Event::TradeEnd { reason: "done".into() });
        }
        if let Some(r) = rest.strip_prefix("end") {
            self.trade = None;
            return Some(Event::TradeEnd {
                reason: r.trim().to_string(),
            });
        }
        if rest.trim() == "." {
            let (id, name, me, you) = self.trade.take()?;
            return Some(Event::Trade { id, name, me, you });
        }
        let t = self.trade.as_mut()?;
        let (head, fields) = rest.split_once('\t').unwrap_or((rest, ""));
        let mut head = head.split_whitespace();
        let side = match head.next()? {
            "me" => &mut t.2,
            "you" => &mut t.3,
            _ => return None,
        };
        if head.next().is_none() {
            for f in fields.split('\t') {
                match f.split_once('=') {
                    Some(("gp", v)) => side.gp = v.trim().parse().unwrap_or(0),
                    Some(("ok", v)) => side.ok = v.trim() == "1",
                    _ => {}
                }
            }
        } else if side.items.len() < 16 {
            let from = fields
                .split('\t')
                .find_map(|f| f.strip_prefix("from="))
                .unwrap_or("")
                .to_string();
            side.items.push(TradeItem {
                from,
                item: parse_item(fields),
            });
        }
        None
    }

    /// 攻撃の待ち (`#attack` 〜 `#end-at`) の最中か
    pub fn attacking(&self) -> bool {
        self.mode.attack
    }

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
        let full = self.ulist.len() >= MAX_LIST_LINES;
        match self.ulist.iter_mut().find(|(n, _)| *n == name) {
            Some(entry) => entry.1 = no,
            None if !full => self.ulist.push((name, no)),
            None => {}
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
        let full = self.name_magnify.len() >= MAX_LIST_LINES;
        match self.name_magnify.iter_mut().find(|(n, _)| n == name) {
            Some(entry) => entry.1 = magnify,
            None if !full => self.name_magnify.push((name.to_string(), magnify)),
            None => {}
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
                .map(|&[chip, attr]| Cell {
                    chip,
                    attr,
                    ..Default::default()
                })
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
        self.v6_blocked.clear();
        self.v6_sets.clear();
    }

    /// `#v6 A NN ` の9バイトの後に W 文字。マスのマップセットの枠を 16 進 1 文字で。0 のマスは属性の下位 2 ビットも 0
    fn parse_v6_a(&mut self, raw: &[u8]) {
        let Some((row, sets)) = v6_row(raw, self.v6_size.0 as usize) else {
            return;
        };
        for (x, &c) in sets.iter().enumerate() {
            if let Some(set) = (c as char).to_digit(16).filter(|&s| s != 0) {
                self.v6_sets.push((row, x, set as u8));
            }
        }
    }

    /// `#v6 X NN ` の9バイトの後に W 文字。`x` のマスは見た目と違って通れない
    fn parse_v6_x(&mut self, raw: &[u8]) {
        let Some((row, marks)) = v6_row(raw, self.v6_size.0 as usize) else {
            return;
        };
        for (x, &m) in marks.iter().enumerate() {
            if m == b'x' {
                self.v6_blocked.push((row, x));
            }
        }
    }

    /// `#v6 R NN ` の9バイトの後に (chip, attr) が W 組並ぶ。NN は 10 進 2 桁の行番号で、0 が上の行
    fn parse_v6_r(&mut self, raw: &[u8]) {
        let Some((row, chip)) = v6_row(raw, self.v6_size.0 as usize * 2) else {
            return;
        };
        if let Some(slot) = self.v6_rows.get_mut(row) {
            *slot = Some(
                chip.as_chunks::<2>()
                    .0
                    .iter()
                    .map(|&[chip, attr]| Cell {
                        chip,
                        attr,
                        ..Default::default()
                    })
                    .collect(),
            );
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
        let mut cells: Vec<Cell> = rows.into_iter().flatten().flatten().collect();
        for (y, x) in std::mem::take(&mut self.v6_blocked) {
            if let Some(c) = cells.get_mut(y * w as usize + x) {
                c.blocked = true;
            }
        }
        for (y, x, set) in std::mem::take(&mut self.v6_sets) {
            if let Some(c) = cells.get_mut(y * w as usize + x) {
                c.set = Some(set);
            }
        }
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
        speech: None,
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
    cond_flags(text.get(6..).unwrap_or(""))
}

/// 毒・麻痺・恐慌・混乱・狂暴・沈黙・盲目の順の7文字(`*` が有効)
fn cond_flags(text: &str) -> Cond {
    let mut flags = [false; 7];
    for (slot, ch) in flags.iter_mut().zip(text.chars().take(7)) {
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

/// `#v6 R`・`#v6 X`・`#v6 A` の `#v6 ? NN ` の行番号と、9バイトの後の `len` バイト
fn v6_row(raw: &[u8], len: usize) -> Option<(usize, &[u8])> {
    let row = ascii_uint(std::str::from_utf8(raw.get(6..8)?).ok()?)?;
    Some((row as usize, raw.get(9..9 + len)?))
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
    #[test]
    fn party_talk() {
        let mut p = super::Parser::default();
        let evs = p.feed("\"/*color=red*/Wilt/*.*/\" > 集合".as_bytes());
        let [super::Event::Message(m)] = evs.as_slice() else {
            panic!()
        };
        assert_eq!((m.channel, m.from.as_deref()), (super::Channel::Party, Some("Wilt")));
        // 引用符で始まっても、" > が無ければ普通のログ
        let evs = p.feed(b"\"quoted\" text");
        let [super::Event::Message(m)] = evs.as_slice() else {
            panic!()
        };
        assert_eq!(m.channel, super::Channel::Log);
    }

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

    /// `#v6 A` の枠はマスの set になり、0 のマスと次の地図では消える。`#v6 D` は枠の番号をそのまま返す
    #[test]
    fn v6_mapset_slots() {
        let mut p = Parser::new();
        let mut lines = v6_frame(3, 2, [0, 1], &[]);
        lines.insert(3, b"#v6 A 01 0a5".to_vec());
        let m = only_map(feed_all(&mut p, lines));
        assert_eq!(
            m.cells.iter().map(|c| c.set).collect::<Vec<_>>(),
            [None, None, None, None, Some(10), Some(5)]
        );
        let m = only_map(feed_all(&mut p, v6_frame(3, 2, [0, 1], &[])));
        assert!(m.cells.iter().all(|c| c.set.is_none()));
        assert_eq!(
            p.feed(b"#v6 D 6 Castle"),
            vec![Event::Notice(Notice {
                mapset_define: Some((6, "Castle".into())),
                ..Default::default()
            })]
        );
        assert!(p.feed(b"#v6 D 16 Castle").is_empty());
    }

    /// `#v6 X` の `x` のマスは blocked になり、次の地図では消える (phi_dm の #v6 X)
    #[test]
    fn v6_blocked_marks() {
        let mut p = Parser::new();
        let mut lines = v6_frame(5, 3, 0..3, &[]);
        let end = lines.pop().unwrap();
        lines.push(b"#v6 X 01 .x..x".to_vec());
        lines.push(end);
        let m = only_map(feed_all(&mut p, lines));
        let blocked: Vec<usize> = m
            .cells
            .iter()
            .enumerate()
            .filter(|(_, c)| c.blocked)
            .map(|(i, _)| i)
            .collect();
        assert_eq!(blocked, [6, 9]);
        let m = only_map(feed_all(&mut p, v6_frame(5, 3, 0..3, &[])));
        assert!(m.cells.iter().all(|c| !c.blocked));
    }

    #[test]
    fn v6_solid_9x9() {
        let mut p = Parser::new();
        let m = only_map(feed_all(&mut p, v6_frame(9, 9, 0..9, &[(4, 4, "me")])));
        assert_eq!((m.width, m.height, m.dir, m.v6), (9, 9, 0, true));
        assert_eq!(m.cells.len(), 81);
        assert_eq!(
            m.cells[0],
            Cell {
                chip: b'0',
                attr: 0,
                ..Default::default()
            }
        );
        assert_eq!(
            m.cells[80],
            Cell {
                chip: b'8',
                attr: 0,
                ..Default::default()
            }
        );
        let c = &m.chars[0];
        assert_eq!(
            (c.x, c.y, c.dir, c.name.as_str(), c.gra.as_str(), c.layer, c.default),
            (4, 4, 'F', "me", "t_man", 12, 1)
        );
        // UI は v6 の印で予想を使うか決める(#m57 の地図には付けない)
        assert_eq!(serde_json::to_value(&m).unwrap()["v6"], true);
    }

    #[test]
    fn v6_coordinates_of_10_or_more() {
        let mut p = Parser::new();
        let m = only_map(feed_all(
            &mut p,
            v6_frame(21, 21, 0..21, &[(10, 10, "me"), (20, 13, "far")]),
        ));
        assert_eq!(
            m.chars.iter().map(|c| (c.x, c.y)).collect::<Vec<_>>(),
            [(10, 10), (20, 13)]
        );
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
        assert_eq!(
            m.cells[11],
            Cell {
                chip: b'1',
                attr: 0,
                ..Default::default()
            }
        );
        assert_eq!((m.chars[0].x, m.chars[0].y), (5, 3));
    }

    #[test]
    fn v6_items_and_bag() {
        let mut p = Parser::new();
        assert!(p.feed(b"#v6 I 1\teq=W\tit=2\twt=1\tmt=3\tfn=6\twp=10\top=12,30,0,0\tready=0\ttype=Weapon\twtype=Sword\tmat=Steel\telem=Fire\teffect=Fire\tse=Power\tcurse=1\tname=Long sword").is_empty());
        assert!(p.feed(b"#v6 I 2").is_empty());
        assert!(p.feed(b"#v6 P 3\tname=/*color=red*/Wilt/*.*/\tarea=Town\tdx=-2\tdy=1\tidle=65\tlag=3\thp=90\tmhp=100\tmp=5\tmmp=50\tcond=*-----*").is_empty());
        assert!(
            p.feed(b"#v6 P 7\tname=Ann\tarea=Cave\tidle=0\thp=1\tmhp=2\tmp=3\tmmp=4\tcond=-------")
                .is_empty()
        );
        let evs = p.feed(b"#v6 P .");
        let [Event::Party { members }] = evs.as_slice() else {
            panic!()
        };
        assert_eq!(
            (
                members[0].no,
                members[0].name.as_str(),
                members[0].dx,
                members[0].dy,
                members[0].lag
            ),
            (3, "Wilt", Some(-2), Some(1), Some(3))
        );
        assert!(members[0].cond.poison && members[0].cond.blind && !members[0].cond.palsy);
        assert_eq!((members[1].dx, members[1].lag, members[1].mmp), (None, None, 4));
        assert_eq!(p.feed(b"#v6 P ."), vec![Event::Party { members: vec![] }]);
        let evs = p.feed(b"#v6 I .");
        let [Event::Items { items }] = evs.as_slice() else {
            panic!("{evs:?}")
        };
        assert_eq!(items.len(), 2);
        let w = items[0].as_ref().unwrap();
        assert_eq!(
            (w.eq.as_str(), w.it, w.wt, w.fn_, w.op[0], w.name.as_str()),
            ("W", 2, 1, 6, 12, "Long sword")
        );
        assert_eq!(
            (w.effect.as_deref(), w.se.as_deref(), w.curse),
            (Some("Fire"), Some("Power"), true)
        );
        assert_eq!(items[1], None);
        assert!(p.feed(b"#ex-inv I 1\teq=-\tit=6\tcount=3\tname=Wand").is_empty());
        let evs = p.feed(b"#ex-inv .");
        let [Event::Bag { items }] = evs.as_slice() else {
            panic!("{evs:?}")
        };
        assert_eq!((items[0].count, items[0].name.as_str()), (Some(3), "Wand"));
        assert_eq!(
            p.feed(b"#ex-inv no hand"),
            vec![Event::BagRefused { reason: "hand".into() }]
        );
        // 名前のタグは除き、HTML では色にする
        p.feed(b"#ex-inv I 1\tname=/*color=red*/Ruby/*.*/ ring");
        let evs = p.feed(b"#ex-inv .");
        let [Event::Bag { items }] = evs.as_slice() else {
            panic!("{evs:?}")
        };
        assert_eq!(items[0].name, "Ruby ring");
        assert!(items[0].html.contains("color:red"), "{}", items[0].html);
    }

    #[test]
    fn v6_moved() {
        let mut p = Parser::new();
        assert_eq!(
            p.feed(b"#v6 G 0 -1"),
            vec![Event::Moved {
                dx: 0,
                dy: -1,
                reason: None
            }]
        );
        assert_eq!(
            p.feed(b"#v6 G 0 0"),
            vec![Event::Moved {
                dx: 0,
                dy: 0,
                reason: None
            }]
        );
        assert_eq!(
            p.feed(b"#v6 G 0 0 wall"),
            vec![Event::Moved {
                dx: 0,
                dy: 0,
                reason: Some("wall".into())
            }]
        );
        assert_eq!(
            p.feed(b"#v6 G 1 0 push"),
            vec![Event::Moved {
                dx: 1,
                dy: 0,
                reason: Some("push".into())
            }]
        );
        assert_eq!(
            p.feed(b"#v6 W cast=12 3"),
            vec![Event::Wait {
                who: None,
                kind: "cast".into(),
                ticks: Some(12),
                spell: Some(3)
            }]
        );
        assert_eq!(
            p.feed(b"#v6 W C0002 cast=stop"),
            vec![Event::Wait {
                who: Some(2),
                kind: "cast".into(),
                ticks: None,
                spell: None
            }]
        );
        assert_eq!(
            p.feed(b"#v6 W at=7"),
            vec![Event::Wait {
                who: None,
                kind: "at".into(),
                ticks: Some(7),
                spell: None
            }]
        );
        assert_eq!(
            p.feed(b"#v6 H C001a hp=42 ag=1"),
            vec![Event::CharHp {
                id: 0x1a,
                hp: 42,
                ag: true,
                merc: false,
                low: false
            }]
        );
        assert_eq!(
            p.feed(b"#v6 H C001b hp=100 ag=0 merc=1"),
            vec![Event::CharHp {
                id: 0x1b,
                hp: 100,
                ag: false,
                merc: true,
                low: false
            }]
        );
        assert_eq!(
            p.feed(b"#v6 H C001c hp=100 ag=0 low=1"),
            vec![Event::CharHp {
                id: 0x1c,
                hp: 100,
                ag: false,
                merc: false,
                low: true
            }]
        );
        assert_eq!(p.feed(b"#ex-inv F 1\tgp=120"), vec![]);
        let floor = p.feed(b"#ex-inv F .");
        assert!(
            matches!(&floor[..], [Event::Floor { items }] if items.len() == 1 && items[0].gp == Some(120) && items[0].item.is_none())
        );
        assert_eq!(p.feed(b"#v6 B 1\tgp=200\teq=-\tit=1\tname=Iron shield"), vec![]);
        assert!(
            matches!(&p.feed(b"#v6 B .")[..], [Event::Shop { items }] if items[0].gp == Some(200) && items[0].item.as_ref().unwrap().name == "Iron shield")
        );
        assert_eq!(p.feed(b"#v6 K shop"), vec![]);
        assert_eq!(p.feed(b"#v6 K \xe5\xae\xbf\tmenu"), vec![]);
        assert!(
            matches!(&p.feed(b"#v6 K .")[..], [Event::TalkWords { words }] if words.len() == 2 && !words[0].menu && words[1].menu)
        );
        // #v6 T は次の発言の行に種類を付ける
        p.feed(b"#v6 T shout C0003");
        assert!(
            matches!(&p.feed(b"(Kotone) > \x82\xa0")[..], [Event::Message(m)] if m.speech.as_deref() == Some("shout"))
        );
        assert!(matches!(&p.feed(b"Kotone > hi")[..], [Event::Message(m)] if m.speech.is_none()));
        p.feed(b"#v6 L Inn\tdx=3\tdy=-2");
        assert!(
            matches!(&p.feed(b"#v6 L .")[..], [Event::Marks { marks }] if marks[0] == Mark { name: "Inn".into(), dx: 3, dy: -2 })
        );
        p.feed(b"#v6 Q 1\ttitle=Wolf\ttext=3/5");
        p.feed(b"#v6 Q 2\tkind=main\ttitle=Well\ttext=Go");
        assert!(
            matches!(&p.feed(b"#v6 Q .")[..], [Event::Quests { quests }] if quests[0].title == "Wolf" && quests[0].text == "3/5" && quests[0].kind == "sub" && quests[1].kind == "main")
        );
        assert_eq!(
            p.feed(b"#v6 Y ask C0002 Bob"),
            vec![Event::TradeAsk {
                id: 2,
                name: "Bob".into()
            }]
        );
        p.feed(b"#v6 Y with C0002 Bob");
        p.feed(b"#v6 Y me\tgp=0\tok=1");
        p.feed(b"#v6 Y me 1\tfrom=put 1\teq=-\tit=3\tname=Nuts");
        p.feed(b"#v6 Y you\tgp=50\tok=0");
        let t = p.feed(b"#v6 Y .");
        assert!(
            matches!(&t[..], [Event::Trade { id: 2, me, you, .. }] if me.ok && me.items[0].from == "put 1" && you.gp == 50 && !you.ok)
        );
        assert_eq!(
            p.feed(b"#v6 Y end moved"),
            vec![Event::TradeEnd { reason: "moved".into() }]
        );
        assert_eq!(
            p.feed(b"#ex-trade no far"),
            vec![Event::TradeRefused { reason: "far".into() }]
        );
        assert!(!p.has_v6_map());
        p.feed(b"#v6 M N 6a3b0000 3 3");
        assert!(p.has_v6_map(), "#v6 M を受けたら v6 の地図の接続 (#194)");
        assert_eq!(p.feed(b"#v6 J"), vec![Event::Jumped]);
        assert_eq!(
            p.feed(b"#v6 E hit 10 12 11 12"),
            vec![Event::Effect {
                kind: "hit".into(),
                from: Some(Pos { x: 10, y: 12 }),
                at: Pos { x: 11, y: 12 },
                element: None,
                category: None,
                wait: None
            }]
        );
        // 攻撃した側が視界の外
        assert_eq!(
            p.feed(b"#v6 E magic -- -- 03 04 fire explode"),
            vec![Event::Effect {
                kind: "magic".into(),
                from: None,
                at: Pos { x: 3, y: 4 },
                element: Some("fire".into()),
                category: Some("explode".into()),
                wait: None
            }]
        );
        assert_eq!(
            p.feed(b"#v6 E chant 03 05 03 05 none - 8"),
            vec![Event::Effect {
                kind: "chant".into(),
                from: Some(Pos { x: 3, y: 5 }),
                at: Pos { x: 3, y: 5 },
                element: Some("none".into()),
                category: None,
                wait: Some(8)
            }]
        );
        // 受けた側が読めなければ捨てる
        assert_eq!(p.feed(b"#v6 E hit 01 01 -- --"), vec![]);
        assert!(p.feed(b"#v6 S 1\tef=1\tfn=6\tname=Fire ball").is_empty());
        assert!(p.feed(b"#v6 S 2\tef=9\tfn=0\tname=/*color=cyan*/Cure/*.*/").is_empty());
        let evs = p.feed(b"#v6 S .");
        let [Event::Spells { spells }] = evs.as_slice() else {
            panic!("{evs:?}")
        };
        assert_eq!(
            spells
                .iter()
                .map(|s| (s.no, s.name.as_str(), s.ef, s.fn_))
                .collect::<Vec<_>>(),
            [(1, "Fire ball", 1, 6), (2, "Cure", 9, 0)]
        );
        assert!(spells[1].html.contains("Cure"));
        assert_eq!(p.feed(b"#v6 S ."), vec![Event::Spells { spells: vec![] }]);
        assert!(
            p.feed(b"#v6 Z 3\tname=Sigma slash\tlen=7\tbonus=350\tcd=105\tleft=0")
                .is_empty()
        );
        assert_eq!(
            p.feed(b"#v6 Z ."),
            vec![Event::Skills {
                skills: vec![Skill {
                    no: 3,
                    name: "Sigma slash".into(),
                    len: 7,
                    bonus: 350,
                    cd: 105,
                    left: 0
                }]
            }]
        );
        assert_eq!(
            p.feed(b"#v6 W skill=3 cd=840 gcd=20"),
            vec![Event::SkillWait {
                no: 3,
                cd: 840,
                gcd: 20
            }]
        );
        assert_eq!(
            p.feed(b"#ex-skill no wait=42"),
            vec![Event::SkillRefused { wait: Some(42) }]
        );
        assert!(p.feed(b"#ex-skill ok 3").is_empty());
        assert_eq!(p.feed(b"#v6 G x"), vec![]);
    }

    /// サーバの eagleeye_m57 と同じ形の行(チップに x、属性に y を入れる)
    fn eagle_frame(w: u8, h: u8) -> Vec<Vec<u8>> {
        let mut lines = vec![b"#ex-eagleeye start".to_vec()];
        for y in 0..h {
            let mut l = format!("#ex-eagleeye M {:02} {y:02} ", w - 1).into_bytes();
            for x in 0..w {
                l.extend([x, y]);
            }
            l.push(b' ');
            lines.push(l);
        }
        lines.push(b"#ex-eagleeye end".to_vec());
        lines
    }

    fn eagle(w: u8, h: u8) -> EagleEye {
        let mut p = Parser::new();
        let mut evs: Vec<Event> = eagle_frame(w, h).iter().flat_map(|l| p.feed(l)).collect();
        let Some(Event::EagleEye(e)) = evs.pop() else {
            panic!("{evs:?}")
        };
        e
    }

    /// v6 の接続には 65x49、それ以外は 15x15 と 11x11 で届く。自キャラは中央
    #[test]
    fn eagleeye_sizes() {
        for (w, h, me) in [(65, 49, (32, 24)), (15, 15, (7, 7)), (11, 11, (5, 5))] {
            let e = eagle(w, h);
            assert_eq!((e.width, e.height), (w as i64, h as i64));
            assert_eq!((e.self_pos.x, e.self_pos.y), me);
            assert_eq!(e.cells.len(), w as usize * h as usize);
            // 行優先で、右下のマスが最後に来る
            let last = e.cells[e.cells.len() - 1];
            assert_eq!((last.chip, last.attr), (w - 1, h - 1));
            assert_eq!(
                e.cells[w as usize],
                Cell {
                    chip: 0,
                    attr: 1,
                    ..Default::default()
                }
            );
        }
    }
}
