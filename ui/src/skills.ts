// 武器の技のボタン (DM の #v6 Z と #ex-skill。phidm-v6 の phi_skill.rs)。
// 技を出すと、その技の待ち (上がるダメージ × 技の数に比例) と、どの技にも掛かる短い共通の待ちに入る。
// 強い技ほど長く待つので、待ちの明けた技を強い順に使うと全ての技が順に出る

import type { Skill } from "./protocol";

/** 魔法の列に並べる技の数。キーは Shift+1〜6 (Shift+7 は地図の切り替え) */
export const MAX_SKILL_BUTTONS = 8;
export const SKILL_KEYS = 6;

/** 並べる技。強い順。全部回せる様に、8 つまでは全て出す */
export function pickSkills(skills: Skill[], max = MAX_SKILL_BUTTONS): Skill[] {
  return [...skills].sort((a, b) => b.bonus - a.bonus || a.no - b.no).slice(0, max);
}

/** 技の待ち。until と ms は技の番号ごと (performance.now の ms)、gcd はどの技にも掛かる共通の待ち */
export type SkillTimers = { until: Record<number, number>; ms: Record<number, number>; gcdUntil: number; gcdMs: number };

/** 技 sk の残りの待ち (ms) と、扇形に使う長さ (ms)。技の待ちと共通の待ちの長い方 */
export function skillLeft(t: SkillTimers | undefined, sk: Skill, now: number): { left: number; total: number } {
  const own = Math.max(0, (t?.until[sk.no] ?? 0) - now);
  const gcd = Math.max(0, (t?.gcdUntil ?? 0) - now);
  return own >= gcd ? { left: own, total: t?.ms[sk.no] ?? own } : { left: gcd, total: t?.gcdMs ?? gcd };
}

/** 待ちの明けた技のうち一番強い物 (自動攻撃が使う)。無ければ null */
export function bestReady(skills: Skill[], t: SkillTimers | undefined, now: number): Skill | null {
  return strongest(skills.filter((sk) => skillLeft(t, sk, now).left === 0));
}

/** 一番強い技 (自動攻撃が使う)。無ければ null */
export function strongest(skills: Skill[]): Skill | null {
  return skills.reduce<Skill | null>((a, b) => (a && a.bonus >= b.bonus ? a : b), null);
}

/**
 * 技が当たった #v6 E hit の分類 `skill-上がる%-名前` (名前の空白は _) を読む。技でなければ null。
 * tier は演出の段: +150% 未満は 1、+300% 未満は 2、それ以上は 3
 */
export function parseSkillFx(category?: string): { bonus: number; name: string; tier: 1 | 2 | 3 } | null {
  const m = /^skill-(\d+)-(.+)$/.exec(category ?? "");
  if (!m) return null;
  const bonus = Number(m[1]);
  return { bonus, name: m[2].replace(/_/g, " "), tier: bonus >= 300 ? 3 : bonus >= 150 ? 2 : 1 };
}
