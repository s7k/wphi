import assert from "node:assert/strict";
import { test } from "node:test";
import { absorb, compose, ringFor } from "./automap.ts";
import type { MapEvent } from "./protocol";

const Q = "?".charCodeAt(0);

function frame(x: number, y: number, chipAt: (i: number) => number, style = "solid"): MapEvent {
  return {
    type: "map",
    size: 7,
    dir: 0,
    style,
    pos: { x, y },
    cells: Array.from({ length: 49 }, (_, i) => ({ chip: chipAt(i), attr: 0 })),
    chars: [{ id: 1, x: 3, y: 3, dir: "F", name: "自分", gra: "", status: 0, gigant: "#", layer: 0, default: 1 }],
  };
}

test("北固定で座標がある時だけ貯める。視界外は貯めない", () => {
  const f = frame(10, 20, (i) => (i === 0 ? Q : 0x20));
  const t = absorb({}, f)!;
  assert.equal(Object.keys(t).length, 48);
  assert.equal(t["7,17"], undefined); // 左上は '?'
  assert.deepEqual(t["10,20"], { chip: 0x20, attr: 0 }); // 中心
  assert.deepEqual(t["13,23"], { chip: 0x20, attr: 0 }); // 右下
  // 同じ地形なら変わらない
  assert.equal(absorb(t, f), null);
  // 回転マップと座標の無いフレームは貯めない
  assert.equal(absorb({}, frame(10, 20, () => 0x20, "turn")), null);
  assert.equal(absorb({}, { ...f, pos: undefined }), null);
});

test("外周に記録地図を置き、中央の '?' も記録で埋める", () => {
  // 1歩東から見た時の地形を貯めておく
  const tiles = absorb({}, frame(11, 20, () => 0x41))!;
  const now = frame(10, 20, (i) => (i === 0 ? Q : 0x20));
  const m = compose(now, tiles, 1)!;
  assert.equal(m.dim, 9);
  // 右端の列(x=14)は記録から
  assert.deepEqual(m.cells[4 * 9 + 8], { chip: 0x41, attr: 0 });
  assert.equal(m.recalled[4 * 9 + 8], true);
  // 左端の列(x=6)は記録が無いので '?'
  assert.deepEqual(m.cells[4 * 9 + 0], { chip: Q, attr: 0 });
  assert.equal(m.recalled[4 * 9 + 0], false);
  // 中央は今見えている地形
  assert.deepEqual(m.cells[4 * 9 + 4], { chip: 0x20, attr: 0 });
  // キャラは外周の幅だけずれる
  assert.deepEqual([m.chars[0].x, m.chars[0].y], [4, 4]);
  assert.equal(compose(now, tiles, 0), null);
});

test("外周の幅は一番外のマスが半分以上見えれば出す", () => {
  assert.equal(ringFor(0, 0, 32), 0);
  assert.equal(ringFor(224, 400, 32), 0);
  // 既定の map 窓のマップの欄(約 284px)でも外周1マス
  assert.equal(ringFor(284, 400, 32), 1);
  assert.equal(ringFor(270, 400, 32), 1);
  assert.equal(ringFor(250, 400, 32), 0);
  assert.equal(ringFor(2000, 2000, 32), 4);
});
