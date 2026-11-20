// 魔法の列 (SpellBar)。サーバの #v6 S で、覚えている呪文の今の番号を知り、番号で唱える。
// 名前で唱えると、phi.td の :U MT の無い世界では詠唱時間が掛からないので、番号で唱える (phi_dm の phi_dm/input.rs の ST_SPELL)。
// 唱えた呪文は一覧の先頭へ移って番号が入れ替わるが、列の並びはキャラごとに最初に見た順で固定する
import type { Spell } from "./protocol";

/** 保存しておいた並び (呪文の名前) に従って並べる。並びに無い呪文は後ろへ足す。返す order は保存する並び */
export function orderSpells(saved: string[], spells: Spell[]): { order: string[]; ordered: Spell[] } {
  const order = [...saved];
  for (const s of spells) if (!order.includes(s.name)) order.push(s.name);
  const byName = new Map(spells.map((s) => [s.name, s]));
  const ordered = order.flatMap((n) => byName.get(n) ?? []);
  return { order, ordered };
}

/** 呪文を唱える行。cast と今の番号 */
export const castLines = (spell: Spell) => `cast\n${spell.no}`;

/**
 * 唱えた後、次の #v6 S が届くまで列を押させないか。先頭 (1 番) 以外を唱えると先頭へ移って番号が入れ替わり、
 * 古い番号で次を押すと別の呪文を唱える
 */
export const waitsForOrder = (spell: Spell) => spell.no !== 1;

/** 番号が入れ替わるのを待つ上限 (ms)。詠唱が取りやめになり #v6 S が来ない時の為 */
export const SPELL_WAIT_MS = 5000;

const KEY = (label: string) => `wphi-spell-order:${label}`;

/** キャラの並びを読む。読めなければ空 */
export function loadSpellOrder(label: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(label)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveSpellOrder(label: string, order: string[]) {
  try {
    localStorage.setItem(KEY(label), JSON.stringify(order));
  } catch {
    // 保存出来なくても、この接続の間は並びを保つ
  }
}
