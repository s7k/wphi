import assert from "node:assert/strict";
import { test } from "node:test";
import { characterTarget, needsCloseConfirm } from "./tabs.ts";

const tabs = [
  { label: "Mirai", session: 1 },
  { label: "Kotone", session: 2, closed: true },
];

test("登録したキャラを開く: タブが無ければ接続、接続中なら移る、切れていれば同じタブで繋ぎ直す", () => {
  assert.deepEqual(characterTarget(tabs, "Haru"), { kind: "connect" });
  assert.deepEqual(characterTarget(tabs, "Mirai"), { kind: "switch", session: 1 });
  assert.deepEqual(characterTarget(tabs, "Kotone"), { kind: "reconnect", session: 2 });
  assert.deepEqual(characterTarget([], "Mirai"), { kind: "connect" });
});

test("接続中のタブだけ、閉じる前に確かめる", () => {
  assert.equal(needsCloseConfirm(tabs[0]), true);
  assert.equal(needsCloseConfirm(tabs[1]), false);
  assert.equal(needsCloseConfirm(undefined), false);
});
