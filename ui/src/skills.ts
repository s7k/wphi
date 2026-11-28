// 武器の技のボタン (DM の #v6 Z と #ex-skill。phidm-v6 の phi_skill.rs)。
// 技を出すと、キャラに 1 つの待ちに入る。待ちは使った技で上がるダメージの割合に比例する (1% ごとに 0.03 秒)

import type { Skill } from "./protocol";

/** 魔法の列に並べる技の数 */
export const MAX_SKILL_BUTTONS = 4;

/**
 * 並べる技を選ぶ。強い順に並べ、多ければ一番強い技から一番弱い技まで、間を等しく空けて 4 つ取る。
 * どれを使っても時間あたりの上乗せは同じなので、待ちの長さの違う物を並べ、場面で選べる様にする
 */
export function pickSkills(skills: Skill[], max = MAX_SKILL_BUTTONS): Skill[] {
  const sorted = [...skills].sort((a, b) => b.bonus - a.bonus || a.no - b.no);
  if (sorted.length <= max) return sorted;
  const picks = new Set(Array.from({ length: max }, (_, i) => Math.round((i * (sorted.length - 1)) / (max - 1))));
  return [...picks].map((i) => sorted[i]);
}

/** 一番強い技 (自動攻撃が使う)。無ければ null */
export function strongest(skills: Skill[]): Skill | null {
  return skills.reduce<Skill | null>((a, b) => (a && a.bonus >= b.bonus ? a : b), null);
}
