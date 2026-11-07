import assert from "node:assert/strict";
import { test } from "node:test";
import { eagleBoard } from "./eagleBoard.ts";

test("EagleEye の盤面", () => {
  const b = eagleBoard({
    type: "eagleEye",
    width: 3,
    height: 2,
    self: { x: 1, y: 1 },
    cells: [
      { chip: 1, attr: 0 },
      { chip: 2, attr: 0x58 },
      { chip: 3, attr: 0x08 },
      { chip: 4, attr: 0 },
      { chip: 5, attr: 0 },
      { chip: 6, attr: 0 },
    ],
  });
  assert.equal(b.dim, 3);
  // 人のマスは属性を消して、既定グラの人を置く
  assert.deepEqual(b.cells[1], { chip: 2, attr: 0 });
  assert.deepEqual(b.chars.map((c) => [c.x, c.y, c.gigant]), [[1, 0, "*"]]);
  assert.deepEqual(b.cells[2], { chip: 3, attr: 0x08 });
  // 盤面の外は ? で埋める
  assert.deepEqual(b.cells[6], { chip: 63, attr: 0 });
});
