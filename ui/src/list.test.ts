import assert from "node:assert/strict";
import { test } from "node:test";
import { listNo, listOk, newList } from "./list.ts";

const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => `[${String(from + i).padStart(2)}] 品物${from + i}`);

test("1ページ目はそのままの番号を送る", () => {
  const l = newList(page(1, 9));
  assert.equal(l.offset, 0);
  assert.deepEqual(listNo(l, 3), { send: "3", close: true });
  assert.deepEqual(listNo(l, 9), { send: "9", close: false });
});

test("2ページ目以降は先頭のずれを足して送る(#43)", () => {
  const l = newList(page(9, 9));
  assert.equal(l.offset, 8);
  assert.deepEqual(listNo(l, 1), { send: "9", close: true });
  // 9 は 3ページ目を頼む 17
  assert.deepEqual(listNo(l, 9), { send: "17", close: false });
  // カーソルとチェックも番号をずらす
  assert.equal(listOk({ ...l, cursor: 8 }), "17");
  assert.equal(listOk({ ...l, checked: l.checked.map((_, i) => i === 0 || i === 2) }), "9 11");
});

test("最後のページ: 9 も範囲外の番号も何もしない", () => {
  const l = newList(page(17, 3));
  assert.equal(listNo(l, 9), null);
  assert.equal(listNo(l, 5), null);
  assert.deepEqual(listNo(l, 2), { send: "18", close: true });
});
