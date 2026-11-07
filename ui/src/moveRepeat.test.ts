import assert from "node:assert/strict";
import { test } from "node:test";
import { MoveRepeat } from "./moveRepeat.ts";

function setup() {
  let t = 0;
  const sent: string[] = [];
  const m = new MoveRepeat((s) => sent.push(s), () => true, () => t);
  return { m, sent, advance: (ms: number) => (t += ms) };
}

test("押した瞬間に1回、押し続けるとマップを受けるたびに1歩", () => {
  const { m, sent, advance } = setup();
  m.keyDown("8", "none", false);
  assert.deepEqual(sent, ["go N"]);
  // 押した直後の自動リピートは送らない
  m.keyDown("8", "none", true);
  advance(100);
  m.tick();
  assert.deepEqual(sent, ["go N"]);
  // 1歩目のマップが返る(まだリピート前)
  m.onMap();
  advance(150);
  m.tick();
  assert.deepEqual(sent, ["go N", "#map-iv 10", "go N"]);
  m.onMap();
  assert.deepEqual(sent.slice(3), ["go N"]);
  // 離すとリピートを終える
  m.keyUp("8");
  m.onMap();
  advance(150);
  m.tick();
  assert.deepEqual(sent.slice(4), ["#map-iv 2"]);
});

test("斜めは2方向を交互に送り、回転は繰り返さない", () => {
  const { m, sent, advance } = setup();
  m.keyDown("8", "none", false);
  m.keyDown("4", "none", false);
  m.onMap();
  m.onMap();
  advance(250);
  m.tick();
  m.onMap();
  m.onMap();
  assert.deepEqual(sent, ["go N", "go W", "#map-iv 10", "go N", "go W", "go N"]);

  const r = setup();
  r.m.keyDown("7", "none", false);
  r.m.onMap();
  r.advance(250);
  r.m.tick();
  r.m.onMap();
  assert.deepEqual(r.sent, ["turn l", "#map-iv 10"]);
});

test("マップを左クリックすると押している間マウスの向きへ進む", () => {
  const { m, sent, advance } = setup();
  m.mouseDown(["8"]);
  assert.deepEqual(sent, ["go N", "#map-iv 10"]);
  // 押した時の分は2回のマップで返ったことにする
  m.onMap();
  m.onMap();
  assert.deepEqual(sent.slice(2), ["go N"]);
  m.mouseMove(["6"]);
  m.onMap();
  assert.deepEqual(sent.slice(3), ["go E"]);
  m.mouseUp();
  advance(150);
  m.tick();
  assert.deepEqual(sent.slice(4), ["#map-iv 2"]);
});

test("進めませんの時は方向が変わった時だけ送る", () => {
  const { m, sent, advance } = setup();
  m.keyDown("8", "none", false);
  m.onMap();
  advance(250);
  m.tick();
  m.onCannotGo();
  assert.deepEqual(sent, ["go N", "#map-iv 10", "go N"]);
  m.keyUp("8");
  m.keyDown("6", "none", false);
  assert.deepEqual(sent.slice(3), ["go E"]);
});
