import assert from "node:assert/strict";
import { test } from "node:test";
import { PREDICT_WAIT_MS, Predictor } from "./predict.ts";

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
  // サーバと同じく、0.1 秒に1歩より詰めない
  assert.equal(p.tick(), false);
  advance(100);
  assert.equal(p.tick(), true);
  assert.deepEqual(p.offset, { dx: 0, dy: -2 });
  advance(100);
  assert.equal(p.tick(), true);
  assert.deepEqual(p.offset, { dx: 1, dy: -2 });
  advance(100);
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

test("返事を待っている移動があれば waiting", () => {
  const { p, advance } = setup();
  p.onMap("5,5,0");
  assert.equal(p.waiting, false);
  p.sent("go N");
  assert.equal(p.waiting, true);
  advance(150);
  p.tick();
  assert.equal(p.waiting, false);
  p.onMap("5,4,0");
  p.sent("go N");
  p.onMap("5,3,0");
  assert.equal(p.waiting, false);
});

test("地図が待つ時間より後に届く回線では、待つ時間を延ばし、先へ進んだ分を戻さない", () => {
  const { p, advance } = setup();
  p.onMap("5,5,0");
  p.sent("go N");
  advance(150);
  assert.equal(p.tick(), true);
  p.sent("go N");
  // 1つ目の地図が 300ms 後に届いた。進んだとみなした1つ目の返事で、2つ目は待ったまま
  advance(150);
  p.onMap("5,4,0");
  assert.equal(p.waiting, true);
  assert.ok(p.wait >= 300);
  advance(140);
  assert.equal(p.tick(), false);
});

test("進んだとみなした後に、次の移動で地図が来たら、両方の返事とみなす(1歩が2歩に見えない)", () => {
  const { p, advance } = setup();
  p.onMap("5,5,0");
  p.sent("go N");
  advance(150);
  p.tick();
  assert.deepEqual(p.offset, { dx: 0, dy: -1 });
  // 一様な所で1歩目は地図が来ず、2歩目で見え方が変わって地図が来た
  p.sent("go N");
  advance(50);
  p.onMap("5,3,0");
  assert.equal(p.waiting, false);
  advance(1000);
  assert.equal(p.tick(), false);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
});

test("進んだとみなした移動に「進めません」が来たら、その分を戻す", () => {
  const { p, advance } = setup();
  p.onMap("5,5,0");
  p.sent("go N");
  advance(150);
  p.tick();
  p.onCannotGo();
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
});

test("進んだとみなした移動に後から地図が来ても、待つ時間を延ばさない", () => {
  const { p, advance } = setup();
  p.onMap("5,5,0");
  for (let i = 0; i < 5; i++) {
    p.sent("go N");
    advance(150);
    p.tick();
  }
  // 一様な所を歩き終えて、何秒か後に見え方が変わった
  advance(3000);
  p.onMap("5,0,0");
  assert.equal(p.wait, PREDICT_WAIT_MS);
});

test("待つ時間は、最近の返事の時間の最大より少し長い", () => {
  const { p, advance } = setup();
  p.onMap("5,0,0");
  for (const [i, ms] of [70, 113, 85].entries()) {
    p.sent("go S");
    advance(ms);
    p.onMap(`5,${i + 1},0`);
  }
  assert.equal(p.wait, 143);
});
