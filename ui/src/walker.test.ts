import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_UNCONFIRMED, WALK_DIAGONAL_MS, WALK_MS, Walker } from "./walker.ts";
import { Predictor } from "./predict.ts";
import type { MapEvent } from "./protocol";

function setup() {
  let t = 0;
  const w = new Walker<string>(() => t);
  return { w, advance: (ms: number) => (t += ms) };
}

test("押している間は、1歩を滑りきるまで次の1歩を返さない", () => {
  const { w, advance } = setup();
  w.keyDown("ArrowUp", "up", "none");
  assert.deepEqual(w.next(true), { keys: ["8"], mods: "none", ms: WALK_MS });
  advance(50);
  assert.equal(w.next(true), null);
  advance(50);
  assert.deepEqual(w.next(true)?.keys, ["8"]);
  // 離したら止まる
  w.keyUp("ArrowUp");
  advance(100);
  assert.equal(w.next(true), null);
});

test("2つの向きを押すと斜めに歩き、2行分の時間で滑らせる。逆向きは打ち消す", () => {
  const { w, advance } = setup();
  w.keyDown("ArrowUp", "up", "none");
  w.keyDown("ArrowRight", "right", "none");
  assert.deepEqual(w.next(true), { keys: ["8", "6"], mods: "none", ms: WALK_DIAGONAL_MS });
  advance(WALK_DIAGONAL_MS);
  w.keyDown("ArrowLeft", "left", "none");
  assert.deepEqual(w.next(true)?.keys, ["8"]);
});

test("返事を待つ移動が多い間と、離した知らせが来ないまま時間が経った後は歩かない", () => {
  const { w, advance } = setup();
  w.keyDown("ArrowDown", "down", "ctrl");
  assert.equal(w.next(false), null);
  assert.deepEqual(w.next(true)?.mods, "ctrl");
  advance(800);
  assert.equal(w.next(true), null);
});

test("キーを押していない間は、追尾移動の向きへ歩き、向きが届かなくなったら止まる", () => {
  const { w, advance } = setup();
  w.setFollow(["2", "4"], "none");
  assert.deepEqual(w.next(true)?.keys, ["2", "4"]);
  advance(WALK_DIAGONAL_MS + 200);
  assert.equal(w.next(true), null);
});

test("スムーズ移動の1歩は返事を待たずに進んだとみなし、鍵の掛かった所へは動かない1歩として順番を残す", () => {
  let t = 0;
  const p = new Predictor(() => t);
  // 5x5 の中央 (2,2) が自キャラ。北 (2,1) が鍵の掛かった箱
  const cells = Array.from({ length: 25 }, (_, i) => ({ chip: i === 7 ? "%".charCodeAt(0) : 32, attr: 0 }));
  const map = { type: "map", width: 5, height: 5, v6: true, dir: 0, style: "solid", cells, chars: [] } as MapEvent;
  p.onMoved(0, 0);
  p.onMap(null, map);
  p.walkStep("go E", WALK_MS);
  assert.deepEqual(p.offset, { dx: 1, dy: 0 });
  assert.equal(p.walk?.ms, WALK_MS);
  // 東へ1歩進んだ先から北は鍵の箱ではないので進む。元の位置の北(鍵の箱)へは進まない
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 1, dy: -1 });
  assert.equal(p.unconfirmed, 2);
  assert.ok(p.unconfirmed >= MAX_UNCONFIRMED);
  // 返事は送った順に来る
  p.onMoved(1, 0);
  p.onMoved(0, -1);
  assert.equal(p.unconfirmed, 0);
  assert.deepEqual(p.offset, { dx: 1, dy: -1 });
  // 地図が来たら確かめた分を消す。今度は北が鍵の箱
  p.onMap(null, map);
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.equal(p.unconfirmed, 1);
  assert.equal(p.onMoved(0, 0), false);
  assert.equal(p.unconfirmed, 0);
  t += 1;
});

test("壁や木へ向かった1歩は進んだとみなさず、揺れの印を付ける。深い水か浅い水か分からない '_' へは進む", () => {
  let t = 0;
  const p = new Predictor(() => t);
  // 5x5 の中央 (2,2) が自キャラ。北が壁、東が木、南が水
  const chip = (i: number) => ({ 7: "#", 13: "T", 17: "_" } as Record<number, string>)[i] ?? " ";
  const cells = Array.from({ length: 25 }, (_, i) => ({ chip: chip(i).charCodeAt(0), attr: 0 }));
  const map = { type: "map", width: 5, height: 5, v6: true, dir: 0, style: "solid", cells, chars: [] } as MapEvent;
  p.onMoved(0, 0);
  p.onMap(null, map);
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.deepEqual(p.walk?.bump, { dx: 0, dy: -1, at: 0 });
  t = 10;
  p.walkStep("go E", WALK_MS);
  assert.deepEqual(p.walk?.bump, { dx: 1, dy: 0, at: 10 });
  p.walkStep("go S", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 1 });
  // 返事は3つとも送った順に合う
  assert.equal(p.unconfirmed, 3);
  p.onMoved(0, 0);
  p.onMoved(0, 0);
  p.onMoved(0, 1);
  assert.equal(p.unconfirmed, 0);
  assert.deepEqual(p.offset, { dx: 0, dy: 1 });
});
