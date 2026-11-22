import assert from "node:assert/strict";
import { test } from "node:test";
import { glideMoves } from "./glide.ts";

const self = { x: 5, y: 5 };
const c = (id: number, x: number, y: number) => ({ id, x, y });

test("前の地図から 1 マス動いたキャラだけを滑らせる", () => {
  const first = glideMoves(new Map(), [c(1, 5, 5), c(2, 7, 5), c(3, 2, 2), c(4, 9, 9)], self, { x: 100, y: 100 });
  assert.equal(first.moved.size, 0, "前の地図が無ければ滑らせない");
  // 2 は東へ 1、3 は動かず、4 はゲートで遠くへ
  const next = glideMoves(first.world, [c(1, 5, 5), c(2, 8, 5), c(3, 2, 2), c(4, 0, 0)], self, { x: 100, y: 100 });
  assert.deepEqual([...next.moved], [[2, { x: 1, y: 0 }]]);
});

test("自キャラが動いても、止まっているキャラは滑らせない", () => {
  const first = glideMoves(new Map(), [c(2, 7, 5), c(3, 2, 2)], self, { x: 100, y: 100 });
  // 自キャラが東へ 1 歩: 地図の上では他のキャラが西へ 1 ずれる
  const next = glideMoves(first.world, [c(2, 6, 5), c(3, 1, 2)], self, { x: 101, y: 100 });
  assert.equal(next.moved.size, 0);
});

test("自キャラの位置がずれた時は (過半数が同じ量で動いた)、どれも滑らせない", () => {
  const first = glideMoves(new Map(), [c(2, 7, 5), c(3, 2, 2), c(4, 3, 8)], self, { x: 100, y: 100 });
  const next = glideMoves(first.world, [c(2, 6, 5), c(3, 1, 2), c(4, 3, 9)], self, { x: 100, y: 100 });
  assert.equal(next.moved.size, 0);
});
