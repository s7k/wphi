// node --test ui/src/keys.test.ts で実行する(Node 24 は型を外して .ts を直接読む)
import assert from "node:assert/strict";
import { test } from "node:test";
import { keyAction } from "./keys.ts";

const key = (code: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}) => ({
  code,
  shiftKey: !!mods.shift,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  metaKey: false,
});
const north = { northFix: true, fullKeyMove: false };
const turn = { northFix: false, fullKeyMove: false };

test("北固定と回転で移動のコマンドが変わる", () => {
  assert.deepEqual(keyAction(key("Numpad8"), north), { send: "go N" });
  assert.deepEqual(keyAction(key("Numpad8"), turn), { send: "go" });
  assert.deepEqual(keyAction(key("ArrowLeft"), north), { send: "go W" });
  // 回転マップの左右の矢印は Shift なしでカニ歩き、Shift ありで回転
  assert.deepEqual(keyAction(key("ArrowLeft"), turn), { send: "go l" });
  assert.deepEqual(keyAction(key("ArrowLeft", { shift: true }), turn), { send: "turn l" });
  assert.deepEqual(keyAction(key("ArrowUp", { ctrl: true }), north), { send: "go n" });
  assert.deepEqual(keyAction(key("Numpad2", { ctrl: true }), turn), { send: "turn s" });
});

test("行動キーと修飾キー", () => {
  assert.deepEqual(keyAction(key("KeyQ"), north), { send: "equip" });
  assert.deepEqual(keyAction(key("KeyP"), north), { pay: true });
  assert.deepEqual(keyAction(key("KeyT", { shift: true }), north), { send: "#ex-map style=solid" });
  assert.deepEqual(keyAction(key("Digit5", { shift: true }), north), { send: "#ex-map size=40" });
  assert.deepEqual(keyAction(key("Tab", { ctrl: true }), north), { nextTab: true });
  assert.equal(keyAction(key("KeyQ", { alt: true }), north), null);
  assert.equal(keyAction(key("KeyG"), north), null);
});

test("フルキー移動", () => {
  const full = { northFix: true, fullKeyMove: true };
  assert.deepEqual(keyAction(key("KeyK"), full), { send: "go S" });
  assert.deepEqual(keyAction(key("Digit8"), full), { send: "go N" });
  assert.deepEqual(keyAction(key("KeyJ"), full), { send: "hit" });
  // 無効なら数字はリストの番号
  assert.deepEqual(keyAction(key("Digit8"), north), { send: "8" });
});
