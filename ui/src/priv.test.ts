import assert from "node:assert/strict";
import { test } from "node:test";
import { privLines, privPartners, usersFromEvent } from "./priv.ts";

const users = usersFromEvent([
  { key: "u3", name: "自分" },
  { key: "u12", name: "花子" },
  { key: "u7", name: "太郎" },
]);

test("受けた priv の会話の相手", () => {
  assert.deepEqual(privPartners("花子", "[花子] &gt; やあ", "自分"), ["花子"]);
  // 3人の会話: 宛先のタグから自分を除く
  assert.deepEqual(privPartners("花子", "<!--to=自分--><!--to=太郎-->やあ", "自分"), ["太郎", "花子"]);
  // 自分に送った分は、宛先のタグの相手の会話になる
  assert.deepEqual(privPartners("自分", "<!--to=花子-->やあ", "自分"), ["花子"]);
});

test("送る行", () => {
  assert.deepEqual(privLines(["花子"], "やあ", users, "自分"), {
    lines: ["priv 12 /*to=花子*/やあ", "priv 3 /*to=花子*/やあ"],
    failed: [],
  });
  assert.deepEqual(privLines(["花子", "いない人"], "x", users, "自分"), {
    lines: ["priv 12 /*to=花子*/x", "priv 3 /*to=花子*/x"],
    failed: ["いない人"],
  });
  assert.deepEqual(privLines(["いない人"], "x", users, "自分"), { lines: [], failed: ["いない人"] });
});
