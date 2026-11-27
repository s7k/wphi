import assert from "node:assert/strict";
import { test } from "node:test";
import { attackPlan, nextTarget } from "./target.ts";
import type { MapChar, MapEvent } from "./protocol";

const ch = (id: number, x: number, y: number, name: string, kind = 1, dir = "F"): MapChar => ({
  id, x, y, dir, name, gra: "", status: 0, gigant: "#", layer: 0, default: kind,
});
// 7x7 の北固定の v6 の地図。自分は真ん中 (3, 3)
const map = (chars: MapChar[]): MapEvent => ({
  type: "map", width: 7, height: 7, v6: true, dir: 0, chars,
  cells: Array.from({ length: 49 }, () => ({ chip: " ".charCodeAt(0), attr: 0 })) as MapEvent["cells"],
});

test("Shift+G は自分・仲間・オブジェを除き、近い順に対象を回す", () => {
  const m = map([ch(1, 3, 3, "Me"), ch(2, 5, 3, "Slime"), ch(3, 3, 4, "Wolf"), ch(4, 3, 2, "Kotone"), ch(5, 4, 3, "看板", 0x81)]);
  assert.equal(nextTarget(m, ["Kotone"], null)?.id, 3);
  assert.equal(nextTarget(m, ["Kotone"], 3)?.id, 2);
  assert.equal(nextTarget(m, ["Kotone"], 2)?.id, 3, "最後の次は最初へ戻る");
  assert.equal(nextTarget(map([ch(1, 3, 3, "Me")]), [], null), null);
  // 狙ってくる敵を先に
  assert.equal(nextTarget(m, ["Kotone"], null, new Set([2]))?.id, 2);
  // 傭兵 (#v6 H の merc) は、隣に居ても狙ってきても対象にしない
  assert.equal(nextTarget(m, ["Kotone"], null, new Set([3]), new Set([3]))?.id, 2);
  assert.equal(nextTarget(map([ch(1, 3, 3, "Me"), ch(3, 3, 4, "Mercenary priest")]), [], null, new Set(), new Set([3])), null);
  // カルマの低い NPC (#v6 H の low。設定でオンの時に渡す) は対象にしない
  assert.equal(nextTarget(m, ["Kotone"], null, new Set(), new Set(), new Set([3]))?.id, 2);
});

test("対象が隣なら向いて殴り、離れていれば近づき、居なければ外す", () => {
  assert.deepEqual(attackPlan(map([ch(2, 4, 3, "Slime")]), 2), { kind: "hit", turn: "e", near: { x: 1, y: 0 } });
  assert.deepEqual(attackPlan(map([ch(2, 3, 2, "Slime")]), 2), { kind: "hit", turn: "n", near: { x: 0, y: -1 } });
  assert.deepEqual(attackPlan(map([ch(2, 3, 6, "Slime")]), 2), { kind: "step", key: "2" });
  assert.deepEqual(attackPlan(map([]), 2), { kind: "lost" });
  // 同じマスに重なったら、隣へよける
  assert.equal(attackPlan(map([ch(2, 3, 3, "Slime")]), 2).kind, "step");
  // 回る地図は画面の上が前で、自分は真ん中より下 (7x7 なら (3, 4))
  assert.deepEqual(attackPlan({ ...map([ch(2, 2, 4, "Slime")]), style: "turn" }, 2), { kind: "hit", turn: "l", near: { x: -1, y: 0 } });
});

test("自動攻撃の待ちの間は、こちらを向いている隣の敵の横へよける", () => {
  // 敵は北隣 (3, 2) で下 (F) を向いている = こちらを向いている。横は (2, 2) か (4, 2)
  const facing = map([ch(2, 3, 2, "Slime", 1, "F")]);
  const p = attackPlan(facing, 2, { dodge: true });
  assert.equal(p.kind, "step");
  // 横へ 1 歩動いた後は、敵の正面でなく横のマスへ寄る (自分 (3, 3)、敵 (4, 2) が下を向く: 正面は (4, 3)、横は (3, 2))
  assert.deepEqual(attackPlan(map([ch(2, 4, 2, "Slime", 1, "F")]), 2), { kind: "step", key: "8" });
  // こちらを向いていなければ、待ちの間は動かない
  assert.deepEqual(attackPlan(map([ch(2, 3, 2, "Slime", 1, "R")]), 2, { dodge: true }), { kind: "wait" });
  // 待ちが明けていれば (dodge でなければ) 殴る
  assert.deepEqual(attackPlan(facing, 2), { kind: "hit", turn: "n", near: { x: 0, y: -1 } });
});

/** (x, y) を壁 (#) にした地図 */
const walled = (m: MapEvent, ...ps: [number, number][]): MapEvent => {
  const cells = [...m.cells];
  for (const [x, y] of ps) cells[y * m.width + x] = { chip: "#".charCodeAt(0), attr: 0 };
  return { ...m, cells };
};

test("回り込む先が壁なら壁へ歩かず、よける先が壁ならその場で殴る", () => {
  // 敵 (4, 2) が下を向く。正面 (4, 3) は自分の東、横 (3, 2) が壁なら、横へは行かず正面のマスから近づく
  assert.deepEqual(attackPlan(walled(map([ch(2, 4, 2, "Slime", 1, "F")]), [3, 2]), 2), { kind: "step", key: "6" });
  // 北隣の敵がこちらを向き、よける横 (2, 3)・(4, 3) が両方とも壁なら、待ちの間もその場で殴る
  const boxed = walled(map([ch(2, 3, 2, "Slime", 1, "F")]), [2, 3], [4, 3]);
  assert.deepEqual(attackPlan(boxed, 2, { dodge: true }), { kind: "hit", turn: "n", near: { x: 0, y: -1 } });
});

test("2x2 の大きな敵も、体のどこかの隣へ回って殴り、正面からはよける", () => {
  const big = (x: number, y: number, dir = "F"): MapChar => ({ ...ch(2, x, y, "Behemoth", 1, dir), gigant: "B" });
  // 体 (4..5, 1..2) の南西の角の南 (4, 3) は自分の東隣。正面 (下向き) なので、横の (3, 2) へ寄る
  assert.deepEqual(attackPlan(map([big(4, 1)]), 2), { kind: "step", key: "8" });
  // 体の北西の角の隣 (北と西) が壁でも、他の隣へ回る
  assert.deepEqual(attackPlan(walled(map([big(5, 0, "R")]), [4, 0]), 2).kind, "step");
  // 隣で正面に居る時、待ちの間は横へよける
  const facing = attackPlan(map([big(3, 1)]), 2, { dodge: true });
  assert.equal(facing.kind, "step");
  // 待ちが明ければ殴る
  assert.deepEqual(attackPlan(map([big(3, 1)]), 2), { kind: "hit", turn: "n", near: { x: 0, y: -1 } });
});
