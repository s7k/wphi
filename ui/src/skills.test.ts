import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSkillFx, pickSkills, strongest } from "./skills.ts";
import type { Skill } from "./protocol";

const sk = (no: number, name: string, len: number, bonus: number): Skill => ({ no, name, len, bonus, cd: Math.max(15, (bonus * 3) / 10), left: 0 });
// 剣の技 (#v6 Z は名前ごとに 1 行)
const sword = [
  sk(1, "9-headed dragon crush", 9, 450), sk(3, "Sigma slash", 7, 350), sk(5, "Omega blast", 5, 250), sk(6, "Z-slash", 5, 250),
  sk(8, "Buster charge", 3, 150), sk(9, "Double slash", 3, 150), sk(11, "Head crush", 2, 100), sk(12, "Side slash", 2, 100),
];

test("技が 4 つより多ければ、一番強い技から一番弱い技まで間を空けて 4 つ選ぶ", () => {
  assert.deepEqual(pickSkills(sword).map((s) => s.name), ["9-headed dragon crush", "Omega blast", "Double slash", "Side slash"]);
  assert.deepEqual(pickSkills(sword.slice(0, 3)).map((s) => s.no), [1, 3, 5]);
  assert.deepEqual(pickSkills([]), []);
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
