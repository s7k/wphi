import assert from "node:assert/strict";
import { test } from "node:test";
import { Predictor } from "./predict.ts";

function setup() {
  let t = 0;
  const p = new Predictor(() => t);
  return { p, advance: (ms: number) => (t += ms) };
}

test("地図も「進めません」も来なければ、0.1 秒ごとに1歩ずつ進んだとみなす", () => {
  const { p, advance } = setup();
  p.onMap("5,5,0");
  p.sent("go N");
  p.sent("go n");
  p.sent("go E");
  advance(100);
  assert.equal(p.tick(), false);
  advance(100);
  assert.equal(p.tick(), true);
  assert.equal(p.tick(), true);
  assert.deepEqual(p.offset, { dx: 0, dy: -2 });
  advance(100);
  assert.equal(p.tick(), true);
  assert.deepEqual(p.offset, { dx: 1, dy: -2 });
  assert.equal(p.tick(), false);
});

test("地図が届いたら本当の位置に戻り、返事の来た移動は数えない", () => {
  const { p, advance } = setup();
  p.onMap("5,5,0");
  p.sent("go N");
  p.sent("go N");
  // 1つ目に地図が来た
  p.onMap("5,4,0");
  advance(200);
  assert.equal(p.tick(), true);
  assert.deepEqual(p.offset, { dx: 0, dy: -1 });
  // 位置の変わらない地図(他のキャラが動いた)は、移動の返事にしないが、ずれは戻す
  p.sent("go N");
  p.onMap("5,4,0");
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  advance(200);
  assert.equal(p.tick(), true);
});

test("「進めません」の移動と、北固定でない移動は進んだとみなさない", () => {
  const { p, advance } = setup();
  p.sent("go N");
  p.onCannotGo();
  p.sent("go");
  p.sent("go b");
  p.sent("turn l");
  advance(200);
  assert.equal(p.tick(), false);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
});
