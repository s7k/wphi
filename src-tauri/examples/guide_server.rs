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

/// 地図の幅と高さ。ログと同じ窓の地図は 13x11 マスを見せ、セッションは外周を1マスずつ足して求める(session.rs の view_line)
const VIEW_W: i32 = 15;
const VIEW_H: i32 = 13;

/// 自分が (x, y) にいる時の、北固定の v6 の受信行
fn frame(x: i32, y: i32, facing: u8) -> Vec<Vec<u8>> {
    let (cx, cy) = ((VIEW_W - 1) / 2, (VIEW_H - 1) / 2);
    let mut lines = vec![format!("#v6 M N {:08x} {VIEW_W} {VIEW_H}", 0x6a3b_0000u32).into_bytes()];
    for r in 0..VIEW_H {
        let mut l = format!("#v6 R {r:02} ").into_bytes();
        for c in 0..VIEW_W {
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
        if (0..VIEW_W).contains(&gx) && (0..VIEW_H).contains(&gy) {
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
    text(&format!("#ex-map view={VIEW_W} {VIEW_H}"));
    text(&format!("#status {ME} : 1820: 2400: 960: 1200: 48210: 3150: 2215: 1840: 960: 1205"));
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
        "slash" => &["DM Mirai は 市場の猫 を /*.*/木の枝 /*color=gray*/で攻撃した. [/*color=-hp*/12/*color=gray*/ hp] "],
        "bolt" => &["Kotone > Fire ball", "DM Kotone は 市場の猫 を /*.*/Fire ball /*color=gray*/で攻撃した. [/*color=-hp*/30/*color=gray*/ hp] "],
        "heal" => &[
            "DM Kotone は Mirai を /*.*/Heal /*color=gray*/で回復した. [/*color=+hp*/40/*color=gray*/ hp] ",
            "DM Kotone は 市場の猫 を /*.*/Mana /*color=gray*/で回復した. [/*color=+mp*/8/*color=gray*/ mp] ",
        ],
        "status" => &["DM Mirai はミスした. ", "DM 市場の猫 は 3 lv の毒を受けた. ", "DM Kotone は 5 秒間 麻痺する. "],
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
                ("application/json", Some(to_events(effect_lines(&scene)).to_string().into_bytes()))
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
            "/log_css" => ("text/css", assets::bundled("Skins/Mine/Style/Log.css").map(<[u8]>::to_vec)),
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
