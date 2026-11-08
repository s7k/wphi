import assert from "node:assert/strict";
import { test } from "node:test";
import { copyText, lineText, selectedLines } from "./logCopy.ts";

const o = { deleteTags: false, deleteTime: true, deleteName: false, cancelTags: false };
const talk = {
  id: 1,
  html: '<font class="class_time">23:51 </font><font class="class_name">勇者</font> &gt; <font class="cl_red">やあ</font>',
  raw: "勇者 > /*cl=red*/やあ/*.*/",
};
const sys = { id: 2, html: '<font class="class_time">23:52 </font><font class="class_system_ng">--- 切断しました ---</font>' };

test("ログの行をコピーする文字にする", () => {
  assert.equal(lineText(talk, o), "勇者 > /*cl=red*/やあ/*.*/");
  assert.equal(lineText(talk, { ...o, deleteTags: true }), "勇者 > やあ");
  assert.equal(lineText(talk, { ...o, deleteName: true, deleteTags: true }), "やあ");
  assert.equal(lineText(talk, { ...o, deleteTime: false, deleteTags: true }), "23:51 勇者 > やあ");
  assert.equal(lineText(talk, { ...o, cancelTags: true }), "勇者 > /＊cl=red*/やあ/＊.*/");
  // 元の行の無い、クライアントが出した行は HTML から文字を取る
  assert.equal(lineText(sys, o), "--- 切断しました ---");
  assert.equal(copyText([talk, sys], { ...o, deleteTags: true }), "勇者 > やあ\n--- 切断しました ---");
});

test("選んだ範囲の行", () => {
  const lines = [talk, sys, { id: 3, html: "c" }];
  assert.deepEqual(selectedLines(lines, [3, 2]).map((l) => l.id), [2, 3]);
  assert.deepEqual(selectedLines(lines, []), []);
});
