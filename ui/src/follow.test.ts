import assert from "node:assert/strict";
import { test } from "node:test";
import { followGoal, followStep, LOST_MS, targetPos } from "./follow.ts";
import type { MapEvent, PartyMember } from "./protocol";

/** 7x7 の北固定の地図。中央 (3,3) が自分。'#' は壁、'?' は見えない所 */
function grid(rows: string[], chars: { x: number; y: number; name: string }[] = []): MapEvent {
  const cells = rows.join("").split("").map((c) => ({ chip: c.charCodeAt(0), attr: 0 }));
  return { type: "map", width: 7, height: 7, v6: true, dir: 0, style: "solid", cells, chars } as unknown as MapEvent;
}
const OPEN = [".......", ".......", ".......", ".......", ".......", ".......", "......."];
const member = (name: string, dx?: number, dy?: number) => ({ name, dx, dy }) as PartyMember;

test("仲間の位置は、地図に見えていればそのキャラ、見えていなければ #v6 P の差", () => {
  const map = grid(OPEN, [{ x: 5, y: 1, name: "/*color=red*/Kotone/*.*/" }]);
  assert.deepEqual(targetPos(map, "Kotone", []), { x: 5, y: 1 });
  assert.deepEqual(targetPos(grid(OPEN), "Haru", [member("Haru", 10, -2)]), { x: 13, y: 1 });
  // 階が違う (dx が無い) と分からない
  assert.equal(targetPos(grid(OPEN), "Haru", [member("Haru")]), null);
});

test("隣に着いたら止まり、まっすぐ行ける時は近づく向きへ歩く", () => {
  assert.equal(followStep(grid(OPEN), { x: 4, y: 3 }), "arrived");
  assert.equal(followStep(grid(OPEN), { x: 3, y: 3 }), "arrived");
  assert.equal(followStep(grid(OPEN), { x: 3, y: 0 }), "8");
  assert.equal(followStep(grid(OPEN), { x: 6, y: 3 }), "6");
});

test("壁を回り込む道を探す", () => {
  // 東に縦の壁。北の端だけ空いている
  const map = grid([".......", "....#..", "....#..", "....#..", "....#..", "....#..", "....#.."]);
  assert.equal(followStep(map, { x: 6, y: 3 }), "8");
});

test("地図の外の仲間へは、仲間に一番近い端へ向かう。近づけなければ止まる", () => {
  assert.equal(followStep(grid(OPEN), { x: 20, y: 3 }), "6");
  // 東西南北を壁で囲まれている
  const boxed = grid([".......", ".......", "...#...", "..#.#..", "...#...", ".......", "......."]);
  assert.equal(followStep(boxed, { x: 20, y: 3 }), null);
});

test("見えない所 '?' とサーバの通れない印のマスは歩かない", () => {
  const fog = grid([".......", ".......", ".......", "....???", ".......", ".......", "......."]);
  // 東の道は見えないので、北か南へ回る
  assert.ok(["8", "2"].includes(followStep(fog, { x: 6, y: 3 }) as string));
  const marked = grid(OPEN);
  marked.cells[3 * 7 + 4] = { ...marked.cells[3 * 7 + 4], blocked: true };
  assert.ok(["8", "2"].includes(followStep(marked, { x: 6, y: 3 }) as string));
});

test("ゲートへは隣でなく、その上に乗る", () => {
  assert.equal(followStep(grid(OPEN), { x: 4, y: 3 }, true), "6");
  assert.equal(followStep(grid(OPEN), { x: 3, y: 3 }, true), "arrived");
  // ゲートのマスの見た目が通れない文字でも、乗りに行く
  const gate = grid([".......", ".......", ".......", "....T..", ".......", ".......", "......."]);
  assert.equal(followStep(gate, { x: 4, y: 3 }, true), "6");
});

test("仲間がゲートで飛んだら、前に立っていたマスへ乗りに行き、自分も飛んだら仲間を探し直す", () => {
  const me = { x: 3, y: 3 };
  const mem = {};
  // 仲間は東 2 マスにいる
  assert.deepEqual(followGoal(mem, { x: 5, y: 3 }, { x: 0, y: 0, epoch: 1 }, me, 0), { goal: { x: 5, y: 3 }, onto: false, lost: false });
  // 自分が東へ 1 歩進んだ後、仲間が遠くへ飛んだ
  const r = followGoal(mem, { x: 3, y: 20 }, { x: 1, y: 0, epoch: 1 }, me, 100);
  assert.deepEqual(r, { goal: { x: 4, y: 3 }, onto: true, lost: false });
  // ゲートに乗って自分も飛んだ (epoch が変わる)。今の仲間の位置へ向かう
  assert.deepEqual(followGoal(mem, { x: 3, y: 5 }, { x: 0, y: 0, epoch: 2 }, me, 200), { goal: { x: 3, y: 5 }, onto: false, lost: false });
});

test("見失って LOST_MS 経ったら、やめる", () => {
  const me = { x: 3, y: 3 };
  const mem = {};
  const walk = { x: 0, y: 0, epoch: 1 };
  assert.equal(followGoal(mem, null, walk, me, 0).lost, false);
  assert.equal(followGoal(mem, null, walk, me, LOST_MS).lost, false);
  assert.equal(followGoal(mem, null, walk, me, LOST_MS + 1).lost, true);
  // 見えたら数え直す
  followGoal(mem, { x: 5, y: 3 }, walk, me, LOST_MS + 2);
  assert.equal(followGoal(mem, null, walk, me, LOST_MS + 3).lost, false);
});

test("自分の歩いた位置がまだ分からない (ログインしてから一度も歩いていない) 時も、見えている仲間へ向かう", () => {
  const me = { x: 3, y: 3 };
  const mem = {};
  assert.deepEqual(followGoal(mem, { x: 6, y: 3 }, undefined, me, 0), { goal: { x: 6, y: 3 }, onto: false, lost: false });
  assert.equal(followGoal(mem, null, undefined, me, 1).lost, false);
  assert.equal(followGoal(mem, null, undefined, me, LOST_MS + 2).lost, true);
});

test("2x2 の大きな敵の体 (印 'B') は 4 マスとも歩かず、回り込む", () => {
  // (4,2) が基準マスで、体は (4,2) (5,2) (4,3) (5,3)。東の仲間へは南を回る
  const big = { x: 4, y: 2, name: "Kyojin", gigant: "B" };
  assert.equal(followStep(grid(OPEN), { x: 6, y: 3 }), "6");
  assert.equal(followStep(grid(OPEN, [big]), { x: 6, y: 3 }), "2");
});
