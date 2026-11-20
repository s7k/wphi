import assert from "node:assert/strict";
import { test } from "node:test";
import { castLines, moveSpell, orderSpells, waitsForOrder } from "./spells.ts";
import type { Spell } from "./protocol";

const sp = (no: number, name: string): Spell => ({ no, name, html: name, ef: 1, fn: 0 });

test("列の並びは最初に見た順で固定し、唱えて番号が入れ替わっても動かない", () => {
  const first = orderSpells([], [sp(1, "Cure"), sp(2, "Fire ball"), sp(3, "Shell")]);
  assert.deepEqual(first.order, ["Cure", "Fire ball", "Shell"]);
  // Shell を唱えて先頭へ移った
  const after = orderSpells(first.order, [sp(1, "Shell"), sp(2, "Cure"), sp(3, "Fire ball")]);
  assert.deepEqual(after.ordered.map((s) => s.name), ["Cure", "Fire ball", "Shell"]);
  // 番号は今の番号
  assert.deepEqual(after.ordered.map((s) => s.no), [2, 3, 1]);
});

test("新しく覚えた呪文は後ろへ足し、忘れた呪文は列から消すが並びは覚えておく", () => {
  const r = orderSpells(["Cure", "Fire ball", "Shell"], [sp(1, "Haste"), sp(2, "Cure"), sp(3, "Shell")]);
  assert.deepEqual(r.ordered.map((s) => s.name), ["Cure", "Shell", "Haste"]);
  assert.deepEqual(r.order, ["Cure", "Fire ball", "Shell", "Haste"]);
});

test("番号で唱え、先頭以外を唱えた時は番号が入れ替わるのを待つ", () => {
  assert.equal(castLines(sp(3, "Shell")), "cast\n3");
  assert.equal(waitsForOrder(sp(1, "Cure")), false);
  assert.equal(waitsForOrder(sp(3, "Shell")), true);
});

test("列を並べ替えた並びを保存し、唱えて番号が入れ替わっても保つ", () => {
  const shown = ["Cure", "Fire ball", "Shell"];
  // Shell を先頭へ
  const order = moveSpell(shown, shown, 2, 0);
  assert.deepEqual(order, ["Shell", "Cure", "Fire ball"]);
  const r = orderSpells(order, [sp(1, "Fire ball"), sp(2, "Shell"), sp(3, "Cure")]);
  assert.deepEqual(r.ordered.map((s) => s.name), ["Shell", "Cure", "Fire ball"]);
  // 末尾へ、範囲の外の to は端へ寄せる
  assert.deepEqual(moveSpell(shown, shown, 0, 99), ["Fire ball", "Shell", "Cure"]);
  // 範囲の外の from は何もしない
  assert.deepEqual(moveSpell(shown, shown, 5, 0), shown);
});

test("並べ替えても、忘れて列に出ていない呪文は並びの後ろに残す", () => {
  const order = ["Cure", "Haste", "Fire ball", "Shell"];
  const shown = ["Cure", "Fire ball", "Shell"];
  assert.deepEqual(moveSpell(order, shown, 0, 2), ["Fire ball", "Shell", "Cure", "Haste"]);
});
