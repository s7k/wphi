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

test("G は自分・仲間・オブジェを除き、近い順に対象を回す", () => {
  const m = map([ch(1, 3, 3, "Me"), ch(2, 5, 3, "Slime"), ch(3, 3, 4, "Wolf"), ch(4, 3, 2, "Kotone"), ch(5, 4, 3, "看板", 0x81)]);
  assert.equal(nextTarget(m, ["Kotone"], null)?.id, 3);
  assert.equal(nextTarget(m, ["Kotone"], 3)?.id, 2);
  assert.equal(nextTarget(m, ["Kotone"], 2)?.id, 3, "最後の次は最初へ戻る");
  assert.equal(nextTarget(map([ch(1, 3, 3, "Me")]), [], null), null);
  // 狙ってくる敵を先に
  assert.equal(nextTarget(m, ["Kotone"], null, new Set([2]))?.id, 2);
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
