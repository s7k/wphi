import assert from "node:assert/strict";
import { test } from "node:test";
import { bestReady, parseSkillFx, pickSkills, skillLeft, strongest } from "./skills.ts";
import type { Skill } from "./protocol";

const sk = (no: number, name: string, len: number, bonus: number): Skill => ({ no, name, len, bonus, cd: Math.max(15, (bonus * 3) / 10), left: 0 });
// 剣の技 (#v6 Z は名前ごとに 1 行)
const sword = [
  sk(1, "9-headed dragon crush", 9, 450), sk(3, "Sigma slash", 7, 350), sk(5, "Omega blast", 5, 250), sk(6, "Z-slash", 5, 250),
  sk(8, "Buster charge", 3, 150), sk(9, "Double slash", 3, 150), sk(11, "Head crush", 2, 100), sk(12, "Side slash", 2, 100),
];

test("技は強い順に 8 つまで並べる", () => {
  assert.deepEqual(pickSkills(sword).map((s) => s.no), [1, 3, 5, 6, 8, 9, 11, 12]);
  assert.deepEqual(pickSkills(sword, 2).map((s) => s.no), [1, 3]);
  assert.deepEqual(pickSkills([]), []);
});

test("待ちは技ごとと共通の長い方。自動攻撃は待ちの明けた一番強い技を使う", () => {
  const t = { until: { 1: 5000 }, ms: { 1: 108000 }, gcdUntil: 1500, gcdMs: 2000 };
  assert.deepEqual(skillLeft(t, sword[0], 1000), { left: 4000, total: 108000 });
  assert.deepEqual(skillLeft(t, sword[1], 1000), { left: 500, total: 2000 });
  assert.equal(bestReady(sword, t, 1000), null, "共通の待ちの間はどれも出ない");
  assert.equal(bestReady(sword, t, 2000)?.name, "Sigma slash", "一番強い技が待ちなら、次に強い技");
  assert.equal(bestReady(sword, undefined, 0)?.name, "9-headed dragon crush");
});

test("自動攻撃は一番強い技を使う", () => {
  assert.equal(strongest(sword)?.name, "9-headed dragon crush");
  assert.equal(strongest([]), null);
});

test("技の演出の分類を読み、上がるダメージで段を決める", () => {
  assert.deepEqual(parseSkillFx("skill-350-Sigma_slash"), { bonus: 350, name: "Sigma slash", tier: 3 });
  assert.equal(parseSkillFx("skill-150-Double_slash")?.tier, 2);
  assert.equal(parseSkillFx("skill-20-Side_slash")?.tier, 1);
  assert.equal(parseSkillFx(undefined), null);
  assert.equal(parseSkillFx("explode"), null);
});
