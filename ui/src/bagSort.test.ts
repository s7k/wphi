// node --test ui/src/bagSort.test.ts で実行する
import assert from "node:assert/strict";
import { test } from "node:test";
import { SORTS, sortItems } from "./bagSort.ts";
import type { ItemInfo } from "./protocol";

const item = (name: string, it: number, wt: number, fn: number, atk: number, wp: number) =>
  ({ name, it, wt, fn, wp, op: [atk, 0, 0, 0] }) as unknown as ItemInfo;
// サーバの並び (名前の順) に番号を付けた物
const bag = [item("Axe", 2, 5, 3, 15, 12), item("Gem", 5, 0, 9, 1, 1), item("Nuts", 3, 0, 1, 1, 1), item("Sword", 2, 1, 6, 12, 10)].map(
  (it, i) => ({ it, no: i + 1 }),
);
const order = (label: string) => sortItems(bag, SORTS.findIndex((s) => s.label === label)).map(({ it, no }) => `${no}:${it.name}`);

test("並べ替えても番号は変えず、同じ値の中はサーバの並びを保つ", () => {
  assert.deepEqual(order("名前"), ["1:Axe", "2:Gem", "3:Nuts", "4:Sword"]);
  // 用途の順 (武器 2 → 食べ物 3 → 宝石 5)。武器の中は種類の順 (剣 1 → 斧 5)
  assert.deepEqual(order("種類"), ["4:Sword", "1:Axe", "3:Nuts", "2:Gem"]);
  assert.deepEqual(order("属性"), ["3:Nuts", "1:Axe", "4:Sword", "2:Gem"]);
  // 攻撃力と重さは大きい順。同じ値 (Gem と Nuts) は名前の順のまま
  assert.deepEqual(order("攻撃力"), ["1:Axe", "4:Sword", "2:Gem", "3:Nuts"]);
  assert.deepEqual(order("重さ"), ["1:Axe", "4:Sword", "2:Gem", "3:Nuts"]);
});
