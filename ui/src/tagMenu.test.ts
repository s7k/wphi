import assert from "node:assert/strict";
import { test } from "node:test";
import { TAG_MENU, wrapTag } from "./tagMenu.ts";

test("選んだ文字をタグで囲む(#11)", () => {
  const red = TAG_MENU[0].items[1];
  assert.equal(red.tag, "/*color=red*/");
  assert.deepEqual(wrapTag("abc", 1, 2, red), { value: "a/*color=red*/b/*.*/c", caret: 20 });
  // 値を書くタグは、値の位置にカーソルを置く
  const custom = TAG_MENU[0].items[0];
  assert.deepEqual(wrapTag("x", 0, 1, custom), { value: "/*color=#x*//*.*/", caret: 9 });
  assert.equal(TAG_MENU[2].items[0].tag, "/*style=bold*/");
});
