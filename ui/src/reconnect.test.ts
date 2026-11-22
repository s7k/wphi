import assert from "node:assert/strict";
import { test } from "node:test";
import { afterClose, DEAD_LINE, KICKED_LINE, lossText, RETRY_DELAYS } from "./reconnect.ts";

test("自分で切った時と操作権を移した時は繋ぎ直さず、死んだ時は聞き、他は間を空けて繋ぎ直す", () => {
  const c = { mine: false, died: false, kicked: false };
  assert.deepEqual(afterClose({ ...c, mine: true }, 0), { kind: "none" });
  assert.deepEqual(afterClose({ ...c, kicked: true, died: true }, 0), { kind: "none" });
  assert.deepEqual(afterClose({ ...c, died: true }, 0), { kind: "ask-dead" });
  assert.deepEqual(afterClose(c, 0), { kind: "retry", delay: RETRY_DELAYS[0], nth: 1 });
  assert.deepEqual(afterClose(c, RETRY_DELAYS.length), { kind: "none" });
});

test("死と操作権の移動の知らせを見分ける", () => {
  assert.ok(DEAD_LINE.test("DM > あなたは死にました... "));
  assert.ok(KICKED_LINE.test("DM > 操作権を移動し、このクライアントを閉じます... "));
  assert.ok(!DEAD_LINE.test("Kotone > DM > あなたは死にました"));
});

test("下がった最大 HP と MP を知らせる", () => {
  assert.equal(lossText({ maxHp: 100, maxMp: 50 }, { maxHp: 90, maxMp: 50 }), "死んだので 最大 HP 100 → 90 に下がりました。");
  assert.equal(lossText({ maxHp: 100 }, { maxHp: 100 }), null);
});
