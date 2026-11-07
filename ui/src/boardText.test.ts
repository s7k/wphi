import assert from "node:assert/strict";
import { test } from "node:test";
import { boardText } from "./boardText.ts";

test("看板の行: 改行を揃え、空行は空白にし、最後に . を足す", () => {
  assert.equal(boardText("a\r\n\rb"), "a\n \nb\n.");
  assert.equal(boardText(""), " \n.");
});
