import assert from "node:assert/strict";
import { test } from "node:test";
import { signAuthor } from "./signHead.ts";

const RULE = "----------------------------------------------";

test("看板を読んだ時の、本文の前の「名前 (日付)」と区切りの線から、書いた人と日付を取り出す", () => {
  assert.deepEqual(signAuthor(["Mirai           (2026/11/20 01:23:45)", RULE]), { name: "Mirai", date: "2026/11/20 01:23:45" });
  // 名前に空白を含む。日付は 70 バイト目で切れて閉じ括弧が無い
  assert.deepEqual(signAuthor(["World Master    (Fri Nov 20 01:4", RULE]), { name: "World Master", date: "Fri Nov 20 01:4" });
  // 暦の名前の付いた日付 (phi.td の yname)
  assert.deepEqual(signAuthor(["/*color=gray*/Kotone          (朱蓮暦712/11/20 01:23:45)", RULE]), {
    name: "Kotone",
    date: "朱蓮暦712/11/20 01:23:45",
  });
  // 前の行も見るが、使うのは最後の 2 行
  assert.deepEqual(signAuthor(["何かの発言", "Haru            (2026/01/02 03:04:05)", RULE])?.name, "Haru");
});

test("看板でない #more (区切りの線が無い、行が足りない、名前の形でない) は null", () => {
  assert.equal(signAuthor(["DM > 品書き", "1. 剣"]), null);
  assert.equal(signAuthor([RULE]), null);
  assert.equal(signAuthor([]), null);
  assert.equal(signAuthor(["(2026/11/20)", RULE]), null);
});
