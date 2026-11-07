import assert from "node:assert/strict";
import { test } from "node:test";
import { arrangeRow, itemDrawRect } from "./mapRender.ts";

test("アイテムは Philly と同じく床の上端の8px上に描く(#41)", () => {
  const r = itemDrawRect(1, " ".charCodeAt(0), 32, 64);
  assert.deepEqual([r.dx, r.dy, r.dw, r.dh], [32, 56, 32, 32]);
  // 拡大(scale 2)は上げる量も2倍
  assert.equal(itemDrawRect(1, " ".charCodeAt(0), 64, 128, 2).dy, 112);
  // プロテクションサークルの上は下を11px切る
  const c = itemDrawRect(5, "x".charCodeAt(0), 0, 32);
  assert.deepEqual([c.sy, c.sh, c.dy], [5, 21, 24]);
});

test("同じマスのキャラの並べ方(#42)", () => {
  const c = (x: number, layer: number, gigant: string, name: string) => ({ x, layer, gigant, name });
  const view = (r: { ch: { name: string }; dx: number }[]) => r.map((e) => `${e.ch.name}${e.dx}`);
  // 16x32 が2人は左右に並べる
  assert.deepEqual(view(arrangeRow([c(1, 12, "#", "b"), c(1, 12, "#", "a")])), ["b-8", "a8"]);
  // 32x32 を先(下)、16x32 を後(上)にして右へ寄せる
  assert.deepEqual(view(arrangeRow([c(2, 10, "#", "s"), c(2, 12, "*", "g")])), ["g0", "s8"]);
  // 32x32 が2人、別のマス、3人はずらさない
  assert.deepEqual(view(arrangeRow([c(0, 1, "*", "p"), c(0, 2, "*", "q"), c(3, 1, "#", "r")])), ["p0", "q0", "r0"]);
  assert.deepEqual(view(arrangeRow([c(0, 1, "#", "a"), c(0, 2, "#", "b"), c(0, 3, "#", "c")])), ["a0", "b0", "c0"]);
});
