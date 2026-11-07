import assert from "node:assert/strict";
import { test } from "node:test";
import { boardText } from "./boardText.ts";
import { afterSend, caretLine, EDIT_MAX_LINE, prepareLine } from "./chat.ts";

const plain = { ctrl: false, loud: false, lastLine: true };

test("発言の前処理", () => {
  assert.equal(prepareLine("hi", plain), "hi");
  assert.equal(prepareLine("*叫ぶ", plain), "/**/*叫ぶ");
  assert.equal(prepareLine("叫ぶ", { ...plain, loud: true }), "*叫ぶ");
  assert.equal(prepareLine("みんな", { ...plain, ctrl: true }), "+みんな");
  assert.equal(prepareLine("", plain), null);
  assert.equal(prepareLine("", { ...plain, lastLine: false }), "/**/");
});

test("カーソルの行と送った後", () => {
  const v = "a\nbb\nccc";
  assert.deepEqual(caretLine(v, 0), { text: "a", index: 0, count: 3, start: 0 });
  assert.deepEqual(caretLine(v, 4), { text: "bb", index: 1, count: 3, start: 2 });
  assert.deepEqual(caretLine(v, v.length), { text: "ccc", index: 2, count: 3, start: 5 });
  // 途中の行で送ったら次の行の先頭へ
  assert.deepEqual(afterSend(v, 3), { value: v, caret: 5 });
  // 最後の行で送ったら空の行を足す
  assert.deepEqual(afterSend(v, v.length), { value: "a\nbb\nccc\n", caret: 9 });
  // 行数の上限を超えたら古い行から消す
  const full = Array.from({ length: EDIT_MAX_LINE }, (_, i) => String(i)).join("\n");
  const after = afterSend(full, full.length);
  assert.equal(after.value.split("\n").length, EDIT_MAX_LINE);
  assert.ok(after.value.startsWith("1\n"));
});

test("看板の送る行", () => {
  assert.equal(boardText("一行目\r\n\r\n三行目"), "一行目\n \n三行目\n.");
});
