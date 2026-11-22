// カバンの中の並べ方 (BagPanel.tsx)。並べ替えても、品の番号 (#ex-inv で送る番号) は変えない
import type { ItemInfo } from "./protocol";

/** 用途(IT_*)の番号のうち、並べ方で使う物 */
const IT_WEAPON = 2;

/**
 * カバンの中の並べ方。名前はサーバの並び (名前の順、同じ名前は入れた順) のまま。
 * 他は、その値で並べ、同じ値の中はサーバの並びを保つ (Array.prototype.sort は安定)
 */
export const SORTS: { label: string; key?: (it: ItemInfo) => number }[] = [
  { label: "名前" },
  // 用途 (武器は種類まで) の順
  { label: "種類", key: (it) => it.it * 100 + (it.it === IT_WEAPON ? it.wt : 0) },
  { label: "属性", key: (it) => it.fn },
  // 強い物・重い物を先に
  { label: "攻撃力", key: (it) => -it.op[0] },
  { label: "重さ", key: (it) => -it.wp },
];

/** 番号付きの品を、SORTS[i] の並びにする */
export function sortItems<T extends { it: ItemInfo }>(items: T[], i: number): T[] {
  const key = SORTS[i]?.key;
  return key ? [...items].sort((a, b) => key(a.it) - key(b.it)) : items;
}

