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

test("返事を待つ移動が多い間は歩かない。押したままなら、keydown が届かなくなっても歩き続け、clear() で止まる", () => {
  const { w, advance } = setup();
  w.keyDown("ArrowDown", "down", "ctrl");
  assert.equal(w.next(false), null);
  assert.deepEqual(w.next(true)?.mods, "ctrl");
  // 下を押したまま右を押して離すと、OS のリピートは下に掛からなくなる。それでも下へ歩き続ける
  w.keyDown("ArrowRight", "right", "ctrl");
  w.keyUp("ArrowRight");
  advance(800);
  assert.deepEqual(w.next(true)?.keys, ["2"]);
  w.clear();
  advance(100);
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

test("見た目が壁の隠し通路は、サーバが通したら覚え、同じ向きに続く壁も進む。行き止まりで元に戻す", () => {
  let t = 0;
  const p = new Predictor(() => t);
  // 5x5 の中央 (2,2) が自キャラ。北に壁が2マス続く
  const cells = Array.from({ length: 25 }, (_, i) => ({ chip: (i === 7 || i === 2 ? "#" : " ").charCodeAt(0), attr: 0 }));
  const map = { type: "map", width: 5, height: 5, v6: true, dir: 0, style: "solid", cells, chars: [] } as MapEvent;
  p.onMoved(0, 0);
  p.onMap(null, map);
  // 1歩目は壁とみなして揺らすが、サーバが通した
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.equal(p.onMoved(0, -1), true);
  assert.deepEqual(p.offset, { dx: 0, dy: -1 });
  // 2歩目は同じ向きの壁なので、隠し通路の中とみなして進む
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: -2 });
  // 行き止まりだった。元に戻し、隠し通路の中とみなすのもやめる
  p.onMoved(0, 0);
  assert.deepEqual(p.offset, { dx: 0, dy: -1 });
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: -1 });
  p.onMoved(0, 0);
  // 南へ戻ってから、もう一度北へ。1歩目に通った壁のマスは覚えているので、揺らさずに進む
  p.walkStep("go S", WALK_MS);
  p.onMoved(0, 1);
  p.onMap(null, map);
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: -1 });
  t += 1;
});

/** 5x5 の地図。rows は北から1行ずつ、中央 (2,2) が自キャラ */
function grid(rows: string[]): MapEvent {
  const cells = rows.join("").split("").map((c) => ({ chip: c.charCodeAt(0), attr: 0 }));
  return { type: "map", width: 5, height: 5, v6: true, dir: 0, style: "solid", cells, chars: [] } as MapEvent;
}

test("見えない所への1歩は進めも揺らしもせずに返事を待ち、後の1歩は本当の位置からなぞり直す", () => {
  let t = 0;
  const p = new Predictor(() => t);
  // 東 (3,2) は見えない所だが本当は床。その北 (3,1) は壁、元の位置の北 (2,1) は床
  p.onMoved(0, 0);
  p.onMap(null, grid([".....", "...#.", "...?.", ".....", "....."]));
  p.walkStep("go E", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.equal(p.walk?.bump, undefined);
  assert.equal(p.uncertain, true);
  // 返事を待つ間に送った北への1歩も、見えない所の先なので見せない
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  // サーバは見えない所を通した。北は壁なので、壁の中ではなくその手前に居る
  t = 50;
  assert.equal(p.onMoved(1, 0), true);
  assert.equal(p.uncertain, false);
  assert.deepEqual([p.walk?.x, p.walk?.y], [1, 0]);
  p.onMoved(0, 0);
  assert.deepEqual(p.offset, { dx: 1, dy: 0 });
});

test("進んだとみなした1歩をサーバが断ったら、後の1歩を本当の位置からなぞり直す", () => {
  let t = 0;
  const p = new Predictor(() => t);
  // 東 (3,2) は床(誰かが居て入れない)。その北 (3,1) は床、元の位置の北 (2,1) は壁
  p.onMoved(0, 0);
  p.onMap(null, grid([".....", "..#..", ".....", ".....", "....."]));
  p.walkStep("go E", WALK_MS);
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 1, dy: -1 });
  // 東は断られた。北は元の位置の北(壁)へ向かう事になるので、元の位置に留まる
  assert.equal(p.onMoved(0, 0), true);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.equal(p.walk?.ms, 80);
  assert.equal(p.onMoved(0, 0), false);
});

test("見えない所への1歩を断られたら、その時に揺らす", () => {
  let t = 0;
  const p = new Predictor(() => t);
  p.onMoved(0, 0);
  p.onMap(null, grid([".....", ".....", "...?.", ".....", "....."]));
  p.walkStep("go E", WALK_MS);
  t = 70;
  p.onMoved(0, 0);
  assert.deepEqual(p.walk?.bump, { dx: 1, dy: 0, at: 70 });
  assert.equal(p.uncertain, false);
});

test("斜めのうち片方だけが壁なら、もう片方だけを縦横の1歩の時間で送る", () => {
  let t = 0;
  const p = new Predictor(() => t);
  // 北 (2,1) が壁、東は床
  p.onMoved(0, 0);
  p.onMap(null, grid([".....", "..#..", ".....", ".....", "....."]));
  assert.deepEqual(p.pick(["go N", "go E"]), ["go E"]);
  // 両方とも通れるか、両方とも壁ならそのまま
  assert.deepEqual(p.pick(["go S", "go E"]), ["go S", "go E"]);
  p.onMap(null, grid([".....", "..#..", "...T.", ".....", "....."]));
  assert.deepEqual(p.pick(["go N", "go E"]), ["go N", "go E"]);
  const w = new Walker<string>(() => t);
  w.keyDown("ArrowUp", "up", "none");
  w.keyDown("ArrowRight", "right", "none");
  assert.deepEqual(w.next(true, () => ["6"]), { keys: ["6"], mods: "none", ms: WALK_MS });
});
