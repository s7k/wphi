import assert from "node:assert/strict";
import { test } from "node:test";
import { addWalk, arrangeRow, cellHash, charCells, isBig, drawRange, grassJitter, itemDrawRect, selfPos, SLIDE_DELAY_MS, SLIDE_MIN_MS, slideStep, timedWalk, treeJitter, viewArea, viewFor, walkAt, walkDelay } from "./mapRender.ts";

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

test("滑らかにずらすのは、同じ世界で1〜2マス動いた時だけ", () => {
  assert.deepEqual(slideStep({ world: "A", x: 5, y: 5 }, { world: "A", x: 6, y: 5 }), { dx: 1, dy: 0 });
  assert.deepEqual(slideStep({ world: "A", x: 5, y: 5 }, { world: "A", x: 4, y: 3 }), { dx: -1, dy: -2 });
  assert.equal(slideStep(null, { world: "A", x: 6, y: 5 }), null);
  assert.equal(slideStep({ world: "A", x: 5, y: 5 }, { world: "B", x: 6, y: 5 }), null);
  assert.equal(slideStep({ world: "A", x: 5, y: 5 }, { world: "A", x: 5, y: 5 }), null);
  assert.equal(slideStep({ world: "A", x: 5, y: 5 }, { world: "A", x: 8, y: 5 }), null);
});

test("自キャラのマスは、北固定は中央、回転は後ろに 1/3", () => {
  assert.deepEqual(selfPos(7, 7, false), { x: 3, y: 3 });
  assert.deepEqual(selfPos(7, 7, true), { x: 3, y: 4 });
  assert.deepEqual(selfPos(11, 7, false), { x: 5, y: 3 });
  assert.deepEqual(selfPos(21, 21, true), { x: 10, y: 13 });
});

test("v6 で要求するマス数は、欄に入る数を奇数に切り下げる", () => {
  assert.equal(viewFor(320, 32), 9);
  assert.equal(viewFor(351, 32), 9);
  assert.equal(viewFor(352, 32), 11);
  assert.equal(viewFor(0, 32), 3);
  assert.equal(viewFor(10000, 32), 99);
});

test("v6 は届いた地図の外周1マスを窓の外に置き、7x7 は全部見せる", () => {
  const map = (width: number, height: number, style = "solid") =>
    ({ type: "map" as const, width, height, v6: true as const, dir: 0, style, cells: [], chars: [] });
  // 窓 11x7 に 13x9 を求め、そのまま届いた
  assert.deepEqual(viewArea(map(13, 9), 11, 7), { x: 1, y: 1, w: 11, h: 7 });
  // サーバの上限で高さが 13 に削られた(窓 15 に 17 を求めた)。見せるのは外周を除いた 11
  assert.deepEqual(viewArea(map(17, 13), 15, 15), { x: 1, y: 1, w: 15, h: 11 });
  // 窓を縮めた直後の大きい地図は中央を見せる
  assert.deepEqual(viewArea(map(13, 9), 7, 5), { x: 3, y: 2, w: 7, h: 5 });
  // 外周を除くと 3 に足りない時は外周も見せる
  assert.deepEqual(viewArea(map(3, 3), 5, 5), { x: 0, y: 0, w: 3, h: 3 });
  // 回転は見せる範囲の自キャラが selfPos(見せる大きさ) に来る。9x9 の窓に 11x11 は上に2行、下に0行
  assert.deepEqual(viewArea(map(11, 11, "turn"), 9, 9), { x: 1, y: 2, w: 9, h: 9 });
  assert.deepEqual(viewArea(map(9, 9, "turn"), 7, 7), { x: 1, y: 1, w: 7, h: 7 });
  // 15x15 が届けば 13x13 を見せる
  assert.deepEqual(viewArea(map(15, 15, "turn"), 21, 21), { x: 1, y: 1, w: 13, h: 13 });
  for (const n of [5, 7, 9, 11, 13, 15, 17]) {
    const v = viewArea(map(n, n, "turn"), n - 2, n - 2);
    const all = selfPos(n, n, true);
    assert.deepEqual(selfPos(v.w, v.h, true), { x: all.x - v.x, y: all.y - v.y });
    assert.ok(v.y >= 0 && v.y + v.h <= n);
  }
  assert.deepEqual(viewArea({ ...map(7, 7), v6: undefined }, 11, 7), { x: 0, y: 0, w: 7, h: 7 });
});

test("ずらして描く時は、ずらした向きの反対側の外周の列と行も描く", () => {
  const view = { x: 1, y: 1, w: 11, h: 7 };
  // ずらさなければ窓の中だけ
  assert.deepEqual(drawRange(view, { x: 0, y: 0 }, 13, 9, 32), { c0: 1, c1: 11, r0: 1, r1: 7 });
  // 東へ進んだ直後は右へずらすので、窓の左の外周が入る
  assert.deepEqual(drawRange(view, { x: 20, y: 0 }, 13, 9, 32), { c0: 0, c1: 11, r0: 1, r1: 7 });
  // 北へ進んだ直後は上へずらすので、窓の下の外周が入る
  assert.deepEqual(drawRange(view, { x: 0, y: -32 }, 13, 9, 32), { c0: 1, c1: 11, r0: 1, r1: 8 });
  // 2マスずらしても、地図の外は描かない
  assert.deepEqual(drawRange(view, { x: -64, y: 64 }, 13, 9, 32), { c0: 1, c1: 12, r0: 0, r1: 7 });
  // 7x7 は全部見せるので、ずらしても全部描く
  assert.deepEqual(drawRange({ x: 0, y: 0, w: 7, h: 7 }, { x: 20, y: -20 }, 7, 7, 32), { c0: 0, c1: 6, r0: 0, r1: 6 });
});

test("スムーズ移動は、届いた位置の間を補い、止まっていた後の1歩目は 100ms で滑らせる", () => {
  // 止まっていた所(1000)から 5000 に1歩。4900 まで前の位置にいた事にする
  let ws = addWalk([{ at: 1000, x: 0, y: 0 }], { at: 5000, x: 1, y: 0 });
  assert.deepEqual(ws.map((w) => w.at), [1000, 4900, 5000]);
  assert.equal(walkDelay(ws), SLIDE_MIN_MS);
  assert.deepEqual(walkAt(ws, 4950), { x: 0.5, y: 0 });
  assert.deepEqual(walkAt(ws, 6000), { x: 1, y: 0 });
  // 続けて 120ms おきに歩くと、遅らせる時間を間隔に合わせて延ばす
  ws = addWalk(ws, { at: 5120, x: 2, y: 0 });
  assert.equal(walkDelay(ws), 150);
  assert.deepEqual(walkAt(ws, 5060), { x: 1.5, y: 0 });
});

test("木と草の揺らぎは、場所で決まり、範囲に収まる", () => {
  assert.equal(cellHash(10, 20), cellHash(10, 20));
  assert.notEqual(cellHash(10, 20), cellHash(11, 20));
  for (let i = 0; i < 500; i++) {
    const h = cellHash(i * 7, i * 13);
    const t = treeJitter(h);
    assert.ok(Math.abs(t.dx) <= 3 && Math.abs(t.dy) <= 2);
    const g = grassJitter(h);
    assert.ok(g.x + 6 <= 32 && g.y + 7 <= 32);
  }
});

test("スムーズ移動の経路は、状態が少し遅れて届いても止まらず、急がずに一定の速さで滑る (#146)", () => {
  // 1歩目は 0〜100、2歩目は 100〜200 の予定。2歩目の状態は 125 に届く (遅れ 25ms < SLIDE_DELAY_MS)
  let ws = timedWalk([], -SLIDE_DELAY_MS, 0, 100, { x: 1, y: 0 }, { x: 0, y: 0 });
  const xs: number[] = [];
  for (let now = SLIDE_DELAY_MS; now <= 200 + SLIDE_DELAY_MS; now++) {
    if (now === 125) ws = timedWalk(ws, now - SLIDE_DELAY_MS, 100, 100, { x: 2, y: 0 }, { x: 1, y: 0 });
    xs.push(walkAt(ws, now - SLIDE_DELAY_MS).x);
  }
  // 1ms ごとの移動が、0 から 200 まで同じ (1 マス 100ms)。止まる所も、急ぐ所も無い
  const steps = xs.slice(1).map((x, i) => x - xs[i]);
  assert.ok(steps.every((d) => Math.abs(d - 0.01) < 1e-9), String(steps.filter((d) => Math.abs(d - 0.01) >= 1e-9)));
  assert.equal(xs.at(-1), 2);
});

test("遅れすぎて届いた1歩と、外れを直す1歩は、今描いている位置から残りを滑らせ、跳ばない", () => {
  let ws = timedWalk([], -SLIDE_DELAY_MS, 0, 100, { x: 1, y: 0 }, { x: 0, y: 0 });
  const t = 160 - SLIDE_DELAY_MS;
  const before = walkAt(ws, t);
  // 2歩目 (予定 100〜200) が 160 に届いた。t の位置から 200 まで滑らせる
  ws = timedWalk(ws, t, 100, 100, { x: 2, y: 0 }, { x: 1, y: 0 });
  assert.deepEqual(walkAt(ws, t), before);
  assert.deepEqual(walkAt(ws, 200), { x: 2, y: 0 });
  // 古い点は t の位置を補間出来るだけ残す
  assert.ok(ws.filter((s) => s.at < t).length <= 1);
});

test("2x2 の大きな敵の体は、地図の東・南・南東。回転マップでは盤面の向きで回す", () => {
  const big = { x: 5, y: 5, gigant: "B" };
  const at = (dir: number) => charCells(big, dir).map((p) => `${p.x},${p.y}`).sort();
  assert.deepEqual(at(0), ["5,5", "5,6", "6,5", "6,6"]);
  // 東を向くと、地図の東は盤面の上、地図の南は盤面の右
  assert.deepEqual(at(2), ["5,4", "5,5", "6,4", "6,5"]);
  assert.deepEqual(at(4), ["4,4", "4,5", "5,4", "5,5"]);
  assert.deepEqual(at(6), ["4,5", "4,6", "5,5", "5,6"]);
  // 巨大('*')や普通のキャラは立っているマスだけ
  assert.deepEqual(charCells({ x: 1, y: 2, gigant: "*" }), [{ x: 1, y: 2 }]);
  assert.equal(isBig("B"), true);
  assert.equal(isBig("*"), false);
});
