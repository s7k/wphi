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

#[test]
fn matches_python_parser() {
    let golden: Value = serde_json::from_str(include_str!("golden/parser.json")).unwrap();
    let mut failures = Vec::new();
    for scenario in golden.as_array().unwrap() {
        let name = scenario["name"].as_str().unwrap();
        let mut parser = Parser::new();
        for (i, step) in scenario["steps"].as_array().unwrap().iter().enumerate() {
            let line = unhex(step["line"].as_str().unwrap());
            let got = serde_json::to_value(parser.feed(&line)).unwrap();
            if got != step["events"] {
                failures.push(format!("{name}[{i}]\n  want {}\n  got  {got}", step["events"]));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
