//! 利用者ガイドの画面を撮る為の、架空のサーバの行と画像を返す HTTP サーバ。
//!
//! `cargo run --example guide_server` で 127.0.0.1:5180 に立てる。`tools/guide/` の撮影用のページがここを読む。
//! - `/events`: 架空の受信行を phi-proto のパーサに通した UI のイベント(JSON の配列)。ログは session.rs と同じく HTML にする
//! - `/asset/<種類>?...`: `phi-asset://` と同じ PNG。同梱の分(resources/phi)だけを使う。公開するガイドに、出所の分からない絵を載せない為
//! - `/log_css`、`/log_html?text=`: 同名のコマンドと同じ
//! - `/download_items`: 同梱の unew.ini の一覧。マップチップと PCGL のキャラグラは取得済みにする
//! - `/effects?scene=`: 地図の演出(ui/src/mapPop.ts)を出す受信行のイベント。接続して歩き終わった後に流す
//!
//! 他のプレイヤーの名前や発言が写らないように、名前と発言は全部ここで作る。

#[path = "../src/assets.rs"]
#[allow(dead_code)]
mod assets;
#[path = "../src/download.rs"]
#[allow(dead_code)]
mod download;

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    net::TcpListener,
};

use phi_proto::{
    codec,
    parser::{Event, Parser},
    tag_to_html::{LogOptions, to_html},
};
use serde_json::{Value, json};

/// 世界の地形。1文字が1マス(mapRender.ts の CHIP_BYTE_TO_INDEX)。x は東、y は南へ増える
const WORLD: [&str; 17] = [
    "TTTTTTTTTTTTTTTTTTTTTTTTT",
    "T:::::::::::T:::::::::::T",
    "T::HHHHHHH::::+::TT:::::T",
    "T::HoooooH:::::::::___::T",
    "T::Ho%o%oH::+::::_____::T",
    "T::HoooooH::::::::___:::T",
    "T::HHH[HHH:::::+::::::::T",
    "T:::::  ::::::::::::+:::T",
    "T::::   :::T:::::::::::T",
    "T:+::      ::::::::::::::T",
    "T::::T:::       ::::T:::T",
    "T::::::::::::   ::::::::T",
    "T::+:::::::::: :::+:::::T",
    "T:::::@::::::: :::::::::T",
    "T::::::::::+:: ::::TT:::T",
    "T::::::::::::: :::::::::T",
    "TTTTTTTTTTTTTTTTTTTTTTTTT",
];

const ME: &str = "Mirai";

/// 地図に立たせる他のキャラ(名前, グラ, x, y, 向き)
const OTHERS: [(&str, &str, i32, i32, u8); 4] = [
    ("Kotone", "t_magiciany", 9, 8, b'L'),
    ("Haru", "t_knightx", 11, 9, b'L'),
    ("Sora", "t_elf", 14, 4, b'F'),
    ("市場の猫", "t_catw", 6, 9, b'R'),
];

fn chip(x: i32, y: i32) -> u8 {
    let row = usize::try_from(y).ok().and_then(|y| WORLD.get(y));
    let b = row.and_then(|r| usize::try_from(x).ok().and_then(|x| r.as_bytes().get(x)));
    // 外は木で埋める。行の長さが足りない所は草
    match (row, b) {
        (None, _) => b'T',
        (Some(_), None) if x >= 0 => b':',
        (_, Some(&b)) => b,
        _ => b'T',
    }
}

/// 地図の幅と高さ。既定は、モダンの 1000x640 の窓を覆う 33x25(外周込み)。窓より大きい分は、地図の欄の中央だけを見せる。
/// 環境変数 GUIDE_VIEW="W H" で変える
fn view() -> (i32, i32) {
    std::env::var("GUIDE_VIEW")
        .ok()
        .and_then(|v| {
            v.split_once(' ')
                .and_then(|(w, h)| Some((w.parse().ok()?, h.parse().ok()?)))
        })
        .unwrap_or((33, 25))
}

/// 自分が (x, y) にいる時の、北固定の v6 の受信行
fn frame(x: i32, y: i32, facing: u8) -> Vec<Vec<u8>> {
    let (vw, vh) = view();
    let (cx, cy) = ((vw - 1) / 2, (vh - 1) / 2);
    let mut lines = vec![format!("#v6 M N {:08x} {vw} {vh}", 0x6a3b_0000u32).into_bytes()];
    for r in 0..vh {
        let mut l = format!("#v6 R {r:02} ").into_bytes();
        for c in 0..vw {
            l.push(chip(x + c - cx, y + r - cy));
            l.push(0);
        }
        lines.push(l);
    }
    let mut o = |id: u32, gx: i32, gy: i32, dir: u8, name: &str, gra: &str| {
        let mut l = format!("#v6 O C{id:04x}:{gx:02} {gy:02} {} ", dir as char).into_bytes();
        let mut n = codec::encode(name);
        n.resize(31, b' ');
        l.extend_from_slice(&n);
        l.extend_from_slice(b" 00 ");
        let mut g = gra.as_bytes().to_vec();
        g.resize(15, b' ');
        l.extend_from_slice(&g);
        l.extend_from_slice(b" # 40 ");
        lines.push(l);
    };
    o(1, cx, cy, facing, ME, "t_valkyrie");
    for (i, (name, gra, ox, oy, dir)) in OTHERS.iter().enumerate() {
        let (gx, gy) = (ox - x + cx, oy - y + cy);
        if (0..vw).contains(&gx) && (0..vh).contains(&gy) {
            o(2 + i as u32, gx, gy, *dir, name, gra);
        }
    }
    lines.push(format!("#ex-pos {x} {y}").into_bytes());
    lines.push(b"#v6 .".to_vec());
    lines
}

fn transcript() -> Vec<Vec<u8>> {
    let mut out: Vec<Vec<u8>> = Vec::new();
    let mut text = |s: &str| out.push(codec::encode(s));
    text("#ex-notice land=WPHI Guide");
    text("#ex-notice area=はじまりの草原");
    text("#mapset default");
    text("#ex-map style=solid");
    let (w, h) = view();
    text(&format!("#ex-map view={w} {h}"));
    text(&format!(
        "#status {ME} : 1820: 2400: 960: 1200: 48210: 3150: 2215: 1840: 960: 1205"
    ));
    text("#cond -------");
    text("/*color=#2080d0*/ようこそ WPHI Guide の世界へ。/*.*/");
    text("はじまりの草原に着いた。");
    text("Kotone > こんにちは、Mirai さん");
    text("Haru > 今日は市場が開いてるよ");
    text(&format!("{ME} > こんにちは！ 市場に行ってみます"));
    text("/*color=#d08000*/市場の猫/*.*/ > にゃあ");
    text("Kotone > /*color=red*/赤い文字/*.*/ や /*style=bold*/太字/*.*/ も使えます");
    text("[Sora] > 後でお城の前で会いましょう");
    text("Haru > お城の北の池で釣りが出来るらしい");
    text("Kotone > 看板はお城の入口にあります");
    // お城の周りを一回りしてから入口の前で止まる
    let corners: [(i32, i32); 8] = [(14, 14), (14, 2), (1, 2), (1, 14), (10, 14), (10, 9), (6, 9), (6, 8)];
    let (mut x, mut y) = corners[0];
    for &(tx, ty) in &corners[1..] {
        while (x, y) != (tx, ty) {
            let (dx, dy) = ((tx - x).signum(), (ty - y).signum());
            (x, y) = if dx != 0 { (x + dx, y) } else { (x, y + dy) };
            let facing = match (dx, dy) {
                (1, _) => b'R',
                (-1, _) => b'L',
                (_, 1) => b'F',
                _ => b'B',
            };
            out.extend(frame(x, y, facing));
        }
    }
    out
}

/// 地図の演出を出す行。歩き終わった時の地図では、Mirai が中央、Kotone が3マス東、市場の猫が1マス南にいる
fn effect_lines(scene: &str) -> Vec<Vec<u8>> {
    const DM: &str = "/*color=gray*/DM > ";
    let lines: &[&str] = match scene {
        "talk" => &["Kotone > 市場はこっちです", "市場の猫 > にゃあ"],
        // 持ち物(#v6 I)とインベントリ(#ex-inv)。カバンの画面を撮る時
        "bag" => &[
            "#v6 I 1\teq=W\tit=2\twt=1\tmt=3\tfn=6\twp=10\top=12,30,0,0\tready=0\ttype=Weapon\twtype=Sword\tmat=Steel\telem=Fire\tname=Flame sword",
            "#v6 I 2\teq=A\tit=1\twt=0\tmt=3\tfn=1\twp=8\top=2,25,10,0\tready=0\ttype=Armor\twtype=claw\tmat=Steel\telem=Earth\tname=Iron shield",
            "#v6 I 3\teq=-\tit=6\twt=0\tmt=0\tfn=5\twp=2\top=1,5,9,0\tcount=5\tready=0\ttype=Charged item\twtype=claw\tmat=Leather\telem=Water\tname=Heal wand",
            "#v6 I 4\teq=O\tit=7\twt=0\tmt=4\tfn=2\twp=1\top=0,0,0,0\tready=0\ttype=Accessories\twtype=claw\tmat=Silver\telem=Light\tname=Silver ring",
            "#v6 I 5\teq=-\tit=3\twt=0\tmt=1\tfn=1\twp=1\top=1,0,1,0\tready=0\ttype=Food\twtype=claw\tmat=Wood\telem=Earth\tname=Nuts",
            "#v6 I 6",
            "#v6 I 7",
            "#v6 I 8",
            "#v6 I .",
            // 覚えている呪文 (#v6 S)。地図の右下に魔法の列を出す
            "#v6 S 1\tef=9\tfn=5\tname=Cure",
            "#v6 S 2\tef=1\tfn=6\tname=Fire ball",
            "#v6 S 3\tef=4\tfn=3\tname=Whirlwind",
            "#v6 S 4\tef=16\tfn=1\tname=Protect",
            "#v6 S 5\tef=24\tfn=2\tname=Thunder bind",
            "#v6 S 6\tef=20\tfn=3\tname=Haste",
            "#v6 S 7\tef=29\tfn=5\tname=Antidote",
            "#v6 S 8\tef=68\tfn=2\tname=Save life",
            "#v6 S .",
            "#ex-inv I 1\teq=-\tit=2\twt=5\tmt=3\tfn=3\twp=12\top=15,20,0,0\tready=0\ttype=Weapon\twtype=Axe\tmat=Steel\telem=Air\tname=Battle axe",
            "#ex-inv I 2\teq=-\tit=6\twt=0\tmt=0\tfn=6\twp=2\top=1,2,3,0\tcount=2\tready=30\ttype=Charged item\twtype=claw\tmat=Leather\telem=Fire\tname=Fire rod",
            "#ex-inv I 3\teq=-\tit=5\twt=0\tmt=4\tfn=9\twp=1\top=1,50,0,0\tready=0\ttype=Jewel\twtype=claw\tmat=Silver\telem=Rainbow\tname=Rainbow gem",
            "#ex-inv I 4\teq=-\tit=2\twt=6\tmt=5\tfn=4\twp=14\top=18,10,0,0\tready=0\ttype=Weapon\twtype=Striker\tmat=Mythril\telem=Spirit\tname=Spirit hammer",
            "#ex-inv I 5\teq=-\tit=13\twt=0\tmt=0\tfn=0\twp=1\top=0,0,0,0\tready=0\ttype=Scroll\twtype=claw\tmat=Leather\telem=None\tname=Old map",
            "#ex-inv .",
        ],
        "party-end" => &["#v6 P ."],
        // 仲間の一覧(#v6 P)。Kotone は3マス東、Haru は5マス東の1マス南
        "party" => &[
            "#v6 P 1\tname=Mirai\tarea=はじまりの草原\tdx=0\tdy=0\tidle=0\tlag=1\thp=1820\tmhp=2400\tmp=960\tmmp=1200\tcond=-------",
            "#v6 P 2\tname=Kotone\tarea=はじまりの草原\tdx=3\tdy=0\tidle=4\tlag=2\thp=1310\tmhp=1500\tmp=380\tmmp=1600\tcond=-------",
            "#v6 P 3\tname=Haru\tarea=はじまりの草原\tdx=5\tdy=1\tidle=75\tlag=3\thp=420\tmhp=2100\tmp=150\tmmp=600\tcond=*-----*",
            "#v6 P .",
            "\"Kotone\" > 北の池で集合しましょう",
            "\"Haru\" > 毒を受けたので、少し休みます",
        ],
        // 看板を読んだ時(#more 〜 #end-more)
        // サーバは本文の前に「名前 (日付)」と区切りの線を送る (phi_dm の load_sd)。札の見出しに書いた人を出す
        "sign" => &[
            "Kotone          (2026/11/20 09:30:12)",
            "----------------------------------------------",
            "#more",
            "/*color=#2080d0*/ようこそ/*.*/ お城の入口です",
            "",
            "/*size=large*/北の池/*.*/ では釣りが出来ます",
            "市場は毎朝開きます。/*color=red*/夜は閉まります/*.*/",
            "#end-more",
        ],
        "slash" => {
            &["DM Mirai は 市場の猫 を /*.*/木の枝 /*color=gray*/で攻撃した. [/*color=-hp*/12/*color=gray*/ hp] "]
        }
        "bolt" => &[
            "Kotone > Fire ball",
            "DM Kotone は 市場の猫 を /*.*/Fire ball /*color=gray*/で攻撃した. [/*color=-hp*/30/*color=gray*/ hp] ",
        ],
        "heal" => &[
            "DM Kotone は Mirai を /*.*/Heal /*color=gray*/で回復した. [/*color=+hp*/40/*color=gray*/ hp] ",
            "DM Kotone は 市場の猫 を /*.*/Mana /*color=gray*/で回復した. [/*color=+mp*/8/*color=gray*/ mp] ",
        ],
        "status" => &[
            "DM Mirai はミスした. ",
            "DM 市場の猫 は 3 lv の毒を受けた. ",
            "DM Kotone は 5 秒間 麻痺する. ",
        ],
        "dead" => &["DM 市場の猫 は Mirai に殺された. "],
        "buff" => &[
            "DM 攻撃力が 12 point 上がった. ",
            "DM Mirai は Kotone に /*.*/Protect /*color=gray*/をかけた. ",
            "DM 防御率が 20% 上がった. ",
        ],
        "debuff" => &["DM 市場の猫 の速度が 30% /*.*/Slow /*color=gray*/によって下がった. "],
        _ => &[],
    };
    lines.iter().map(|l| codec::encode(&l.replacen("DM ", DM, 1))).collect()
}

fn events() -> Value {
    to_events(transcript())
}

fn to_events(lines: Vec<Vec<u8>>) -> Value {
    let mut p = Parser::new();
    let opts = LogOptions::default();
    let mut out = Vec::new();
    for line in lines {
        for ev in p.feed(&line) {
            out.push(match ev {
                Event::Message(m) => json!({
                    "type": "log",
                    "channel": m.channel,
                    "html": to_html(&m.text, &opts),
                    "from": m.from,
                    "raw": m.text,
                }),
                ev => serde_json::to_value(ev).unwrap(),
            });
        }
    }
    Value::Array(out)
}

fn query(q: &str) -> HashMap<String, String> {
    let url = tauri::Url::parse(&format!("http://localhost/?{q}")).unwrap();
    url.query_pairs().into_owned().collect()
}

fn main() {
    let assets = assets::Assets::new(Vec::new());
    let listener = TcpListener::bind("127.0.0.1:5180").unwrap();
    eprintln!("http://127.0.0.1:5180");
    for stream in listener.incoming().flatten() {
        let mut stream = stream;
        let mut line = String::new();
        if BufReader::new(&stream).read_line(&mut line).is_err() {
            continue;
        }
        let target = line.split_whitespace().nth(1).unwrap_or("/").to_string();
        let (path, q) = target.split_once('?').unwrap_or((&target, ""));
        let (ty, body): (&str, Option<Vec<u8>>) = match path {
            "/events" => ("application/json", Some(events().to_string().into_bytes())),
            "/effects" => {
                let scene = query(q).remove("scene").unwrap_or_default();
                (
                    "application/json",
                    // near は Kotone の隣(西)へ寄った地図、back は元の所の地図(パーティの画面を撮る時)
                    Some(
                        to_events(match scene.as_str() {
                            "near" => frame(8, 8, b'R'),
                            "back" => frame(6, 8, b'R'),
                            _ => effect_lines(&scene),
                        })
                        .to_string()
                        .into_bytes(),
                    ),
                )
            }
            "/download_items" => {
                let ini = codec::decode(assets::bundled("Config/unew.ini").unwrap_or_default());
                let rows: Vec<Value> = download::items(&ini)
                    .into_iter()
                    .map(|i| {
                        let got = (i.dir == "chip" || i.title.contains("PCGL")).then(|| i.date.clone());
                        let mut v = serde_json::to_value(i).unwrap();
                        v["got"] = json!(got);
                        v
                    })
                    .collect();
                ("application/json", Some(Value::Array(rows).to_string().into_bytes()))
            }
            "/log_css" => (
                "text/css",
                assets::bundled("Skins/Mine/Style/Log.css").map(<[u8]>::to_vec),
            ),
            "/log_html" => {
                let text = query(q).remove("text").unwrap_or_default();
                ("text/html", Some(to_html(&text, &LogOptions::default()).into_bytes()))
            }
            p => match p.strip_prefix("/asset/") {
                Some(kind) => ("image/png", assets.get(kind, &query(q))),
                None => ("text/plain", None),
            },
        };
        let (status, body) = match body {
            Some(b) => ("200 OK", b),
            None => ("404 Not Found", Vec::new()),
        };
        let head = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {ty}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(&body));
    }
}
