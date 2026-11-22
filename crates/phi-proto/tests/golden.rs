//! phi-client-web の Python パーサと出力を比べる。
//! 正解データは `tools/golden/gen.py` で作る。

use phi_proto::Parser;
use serde_json::Value;

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

/// Python 版の地図の `size` を、Rust 版の `width` と `height` に分ける。
/// Python 版は正方形の地図しか知らないので、両方に同じ値を入れる
fn split_size(events: &Value) -> Value {
    let mut events = events.clone();
    for ev in events.as_array_mut().into_iter().flatten() {
        if ev["type"] == "map"
            && let Some(size) = ev.as_object_mut().and_then(|m| m.remove("size"))
        {
            ev["width"] = size.clone();
            ev["height"] = size;
        }
    }
    events
}

#[test]
fn matches_python_parser() {
    let golden: Value = serde_json::from_str(include_str!("golden/parser.json")).unwrap();
    let mut failures = Vec::new();
    for scenario in golden.as_array().unwrap() {
        let name = scenario["name"].as_str().unwrap();
        // WPHI は 5x5 の地図(`#map`)に対応せず、`#map` の行を無視する。
        // Python 版は 5x5 の地図を出すので合わない。正解データは Python 版の出力のまま残す
        if name == "map_5x5" {
            continue;
        }
        let mut parser = Parser::new();
        for (i, step) in scenario["steps"].as_array().unwrap().iter().enumerate() {
            let line = unhex(step["line"].as_str().unwrap());
            // castEnd は WPHI だけのイベント (詠唱の終わり)。Python 版には無いので除いて比べる
            let mut got = serde_json::to_value(parser.feed(&line)).unwrap();
            if let Some(a) = got.as_array_mut() {
                a.retain(|e| e["type"] != "castEnd");
            }
            let want = split_size(&step["events"]);
            if got != want {
                failures.push(format!("{name}[{i}]\n  want {want}\n  got  {got}"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
