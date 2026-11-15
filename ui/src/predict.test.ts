import assert from "node:assert/strict";
import { test } from "node:test";
import { PREDICT_WAIT_MS, Predictor, predictedMap } from "./predict.ts";
import { viewArea } from "./mapRender.ts";
import type { MapEvent } from "./protocol";

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

test("予想した位置の地図は、v6 の北固定の地図を1マスずらし、入る端を '?' にする", () => {
  // 5x3。マスのチップは列と行の番号
  const cell = (x: number, y: number) => ({ chip: x * 10 + y, attr: 0 });
  const chara = (x: number, y: number, name: string) =>
    ({ id: 0, x, y, dir: "F", name, gra: "", status: 0, gigant: "#", layer: 12, default: 0 });
  const map: MapEvent = {
    type: "map",
    width: 5,
    height: 3,
    v6: true,
    dir: 0,
    style: "solid",
    cells: Array.from({ length: 15 }, (_, i) => cell(i % 5, Math.floor(i / 5))),
    chars: [chara(2, 1, "me"), chara(3, 1, "east"), chara(0, 0, "west")],
    pos: { x: 10, y: 20 },
  };
  const m = predictedMap(map, 1, 0);
  assert.deepEqual(m.pos, { x: 11, y: 20 });
  assert.deepEqual(m.cells.slice(0, 5), [cell(1, 0), cell(2, 0), cell(3, 0), cell(4, 0), { chip: 63, attr: 0 }]);
  // 自キャラは中央のまま、東のキャラは1つ近づき、西の端のキャラは外に出る
  assert.deepEqual(m.chars.map((c) => [c.name, c.x, c.y]), [["me", 2, 1], ["east", 2, 1]]);
  // '?' の列は外周に入り、窓に見せる範囲(外周の内側)には来ない
  const v = viewArea(m, 3, 3);
  assert.equal(v.x + v.w, 4);
  assert.ok(m.cells.every((c, i) => i % 5 < 4 || c.chip === 63));
  // #m57 の地図はずらさない
  const m57 = { ...map, v6: undefined };
  assert.equal(predictedMap(m57, 1, 0), m57);
});
