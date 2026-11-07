import assert from "node:assert/strict";
import { test } from "node:test";
import { mouseDir, northFixTurn } from "./mouseDir.ts";

test("マウスの向き", () => {
  const at = (x: number, y: number, northFix = true, mod = false) => mouseDir(x, y, 224, 224, northFix, mod)?.keys;
  assert.deepEqual(at(112, 10), ["8"]);
  assert.deepEqual(at(112, 200), ["2"]);
  assert.deepEqual(at(10, 112), ["4"]);
  assert.deepEqual(at(200, 112), ["6"]);
  assert.deepEqual(at(200, 200), ["2", "6"]);
  assert.equal(at(112, 112), undefined);
  assert.equal(at(300, 10), undefined);
  // 回転マップの上の端と、Shift・Ctrl の左右の半分は回転
  assert.deepEqual(at(10, 10, false), ["7"]);
  assert.deepEqual(at(214, 10, false), ["9"]);
  assert.deepEqual(at(10, 10, true), ["8", "4"]);
  assert.deepEqual(at(150, 200, false, true), ["9"]);
});

test("北固定で Shift・Ctrl を押した時に向く方角(#6)", () => {
  assert.equal(northFixTurn(112, 112, 224, 224), null);
  assert.equal(northFixTurn(130, 100, 224, 224), null);
  assert.equal(northFixTurn(112, 10, 224, 224), "n");
  assert.equal(northFixTurn(220, 112, 224, 224), "e");
  assert.equal(northFixTurn(112, 220, 224, 224), "s");
  assert.equal(northFixTurn(5, 112, 224, 224), "w");
});
