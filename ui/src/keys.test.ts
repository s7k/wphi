// node --test ui/src/keys.test.ts で実行する(Node 24 は型を外して .ts を直接読む)
import assert from "node:assert/strict";
import { test } from "node:test";
import { keyAction, moveCommand, moveInput, type KeyContext } from "./keys.ts";

const key = (code: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}) => ({
  code,
  shiftKey: !!mods.shift,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  metaKey: false,
});
const north = { northFix: true, fullKeyMove: false };
const turn = { northFix: false, fullKeyMove: false };

/** 移動キーなら送るコマンド、そうでなければ keyAction の結果 */
function act(e: ReturnType<typeof key>, ctx: KeyContext) {
  const m = moveInput(e, ctx);
  return m ? { send: moveCommand(m.key, m.mods, ctx.northFix).text } : keyAction(e, ctx);
}

test("北固定と回転で移動のコマンドが変わる", () => {
  assert.deepEqual(act(key("Numpad8"), north), { send: "go N" });
  assert.deepEqual(act(key("Numpad8"), turn), { send: "go" });
  assert.deepEqual(act(key("ArrowLeft"), north), { send: "go W" });
  // 回転マップの左右の矢印は Shift なしでカニ歩き、Shift ありで回転
  assert.deepEqual(act(key("ArrowLeft"), turn), { send: "go l" });
  assert.deepEqual(act(key("ArrowLeft", { shift: true }), turn), { send: "turn l" });
  assert.deepEqual(act(key("ArrowUp", { ctrl: true }), north), { send: "go n" });
  assert.deepEqual(act(key("Numpad2", { ctrl: true }), turn), { send: "turn s" });
});

test("行動キーと修飾キー", () => {
  assert.deepEqual(act(key("KeyQ"), north), { send: "equip" });
  assert.deepEqual(act(key("KeyP"), north), { pay: true });
  assert.deepEqual(act(key("KeyT", { shift: true }), north), { send: "#ex-map style=solid" });
  assert.deepEqual(act(key("Digit5", { shift: true }), north), { send: "#ex-map size=40" });
  assert.deepEqual(act(key("Tab", { ctrl: true }), north), { nextTab: true });
  assert.equal(act(key("KeyQ", { alt: true }), north), null);
  assert.equal(act(key("KeyG"), north), null);
});

test("フルキー移動", () => {
  const full = { northFix: true, fullKeyMove: true };
  assert.deepEqual(act(key("KeyK"), full), { send: "go S" });
  assert.deepEqual(act(key("Digit8"), full), { send: "go N" });
  assert.deepEqual(act(key("KeyJ"), full), { send: "hit" });
  // 無効なら数字はリストの番号
  assert.deepEqual(act(key("Digit8"), north), { send: "8" });
});
