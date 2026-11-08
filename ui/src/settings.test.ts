import assert from "node:assert/strict";
import { test } from "node:test";
import { clampZoom, DEFAULT_SETTINGS, shortcutText } from "./settings.ts";

const key = (code: string, alt = false) => ({ code, shiftKey: false, ctrlKey: false, altKey: alt, metaKey: false });

test("F8〜F12 と Alt+G", () => {
  const s = { ...DEFAULT_SETTINGS, shortcuts: ["", "", "cast\\n1", "", ""], listShortcuts: ["2", "", "", "", ""], altGWord: "おやすみ" };
  assert.equal(shortcutText(key("F10"), s, false), "cast\n1");
  assert.equal(shortcutText(key("F8"), s, false), null);
  assert.equal(shortcutText(key("F8"), s, true), "2");
  assert.equal(shortcutText(key("KeyG", true), s, false), "おやすみ");
  assert.equal(shortcutText(key("F5"), s, false), null);
});

test("マップの拡大率は範囲の整数にする", () => {
  assert.equal(clampZoom(150), 150);
  assert.equal(clampZoom(10), 50);
  assert.equal(clampZoom(1000), 400);
  assert.equal(clampZoom(125.4), 125);
  assert.equal(clampZoom(NaN), 100);
});
