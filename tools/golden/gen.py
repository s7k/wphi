"""phi-client-web の Python パーサを正解として、phi-proto の比較テスト用データを書き出す。

実行:
  python3 tools/golden/gen.py ~/workspace/phi-client-web/backend > crates/phi-proto/tests/golden/parser.json

各シナリオは新しいパーサに行を順に流し、行ごとのイベント列を記録する。
行はバイナリを含むので hex で持つ。
cp932 の 0xA0・0xFD-0xFF は Python と encoding_rs でデコード結果が違う為、入力に含めない。
#more の中の # で始まる行も含めない。phi-proto は Philly と同じくこれをログにし、Python 版はコマンドとして解析する。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

backend = Path(sys.argv[1]).expanduser().resolve()
sys.path.insert(0, str(backend))
sys.path.insert(0, str(backend / "tests" / "fixtures" / "synthetic"))

from app.protocol.parser import ProtocolParser  # noqa: E402
from _build_fixtures import build_m57_M, build_m57_O, build_user  # noqa: E402

SYN = backend / "tests" / "fixtures" / "synthetic"


def sj(s: str) -> bytes:
    return s.encode("cp932")


def fx(name: str) -> bytes:
    return (SYN / name).read_bytes()


cells = [((i * 3) % 256, i % 8) for i in range(49)]
cells2 = [(0x40 + i, 0) for i in range(49)]


def map_5x5() -> bytes:
    # [7]=方角 [18+2i]=chip, [18+2i+50]='.' でアイテム, [18+2i+51]='-' で看板
    buf = bytearray(b"#map M S " + b"0" * 9)
    buf += bytes(120)
    for i in range(25):
        buf[18 + i * 2] = 0x41 + i
    buf[18 + 50] = ord(".")
    buf[18 + 2 + 51] = ord("-")
    return bytes(buf)


def eagle_row(size: int, y: int, pairs: list[tuple[int, int]]) -> bytes:
    head = f"#ex-eagleeye M {size:02d} {y:02d} ".encode("ascii")
    return head + bytes(b for p in pairs for b in p)


o_char = build_m57_O(0, 1, 3, 3, "B", "ExampleChar", 0x40, "t_Lord", "#", 0x40)
o_rat = build_m57_O(1, 0x2A, 1, 5, "L", "野ネズミ", 0x00, "ネズミ", "*", 0x82)
o_wide = b"#m57 W " + o_char[7:74] + b" " + o_rat[7:74]

SCENARIOS: dict[str, list[bytes]] = {
    "fixtures": [fx(n) for n in (
        "status.bin", "cond.bin", "cond_none.bin", "log_plain.bin",
        "log_markup.bin", "priv.bin", "user.bin",
    )],
    "map_frames": [
        fx("m57_M.bin"), fx("m57_O_char.bin"), fx("m57_O_jp.bin"), fx("m57_O_special.bin"), fx("m57_dot.bin"),
        # O 行の無いフレームは前フレームの chars を引き継ぐ(Python 版の挙動)
        build_m57_M("E", "00000001", cells2), b"#m57 .",
        build_m57_M("S", "00000002", cells2), o_rat, b"#m57 .",
        o_wide, b"#m57 .",
        b"#m57 M W short", b"#m57 .",
    ],
    "map_5x5": [map_5x5(), b"#map .", b"#map M -", b"#map ."],
    "map_style_pos_magnify": [
        b"#ex-map style=turn", b"#ex-map size=57",
        sj("#ex-obj S 64 64 1 野ネズミ"), b"#ex-obj S x 1 1 a", b"#ex-obj S 1 1 1",
        b"#ex-pos 10 20", build_m57_M("N", "00000003", cells), o_rat, b"#m57 .",
        b"#m57 .", b"#ex-pos a 1",
    ],
    "modes": [
        b"#attack", b"#attack", b"#end-at", b"#magic", b"#end-mg",
        b"#more", sj("看板の本文"), b"#end-more", b"#end-more",
    ],
    "list": [
        b"#list", sj("1. 剣"), sj("2. 盾"), b"#end-list", sj("リスト後の行"), b"#ex-list-mode-end",
        b"#list", b"#end-list", b"#list",
    ],
    "edit": [b"#s-edit", b"#m-edit", b"#."],
    "chat": [
        build_user(12, "ExampleChar"), build_user(3, "花子"), build_user(12, "ExampleChar"),
        b"#user 00x1 broken                         ", b"#user short",
        sj("ExampleChar > やあ"), sj("花子 > /*cl=red*/赤/*.*/"), sj("NPC > hi"),
        sj("[Bob] > hey"), b"[Bob] x", b"[] > x", sj("> 先頭"),
    ],
    "notice": [
        sj("#name 勇者"), b"#mapset mansion ", sj("#ex-notice land=Fantasy Island Country"),
        sj("#ex-notice area=港町の酒場"), b"#bgm Seiju", b"#ex-notice other=1",
    ],
    "status": [
        b"#status", b"#status t_Lord : 1 : x : 3", b"#status  : 5",
        sj("#status 名前:1:2:3:4:5:6:7:8:9:10:11"), b"#cond *-*----", b"#cond **",
    ],
    "eagleeye": [
        b"#mapset forest",
        b"#ex-eagleeye start",
        eagle_row(2, 0, [(1, 2), (3, 4), (5, 6)]),
        eagle_row(2, 1, [(7, 8), (9, 10), (11, 12)]),
        eagle_row(2, 99, [(1, 1)]),
        b"#ex-eagleeye pos 1 1",
        b"#ex-eagleeye end",
        b"#ex-eagleeye start", b"#ex-eagleeye end",
    ],
    "control": [
        b"#ch-srv 192.0.2.1 9000", b"#ch-srv 192.0.2.1 x", b"#ch-srv only",
        b"#lag", b"#remap", b"#close", b"#x", b"#ex-chr-conflict 1",
        b"#unknown-cmd", b"## not a command", b"# not a command", b"#", b"",
    ],
}

out = []
for name, lines in SCENARIOS.items():
    p = ProtocolParser()
    out.append({
        "name": name,
        "steps": [{"line": line.hex(), "events": p.feed(line)} for line in lines],
    })
json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
print()
