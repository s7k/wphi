import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, shortcutText } from "./settings.ts";

const key = (code: string, alt = false) => ({ code, shiftKey: false, ctrlKey: false, altKey: alt, metaKey: false });

test("F8〜F12 と Alt+G", () => {
  const s = { ...DEFAULT_SETTINGS, shortcuts: ["", "", "cast\\n1", "", ""], listShortcuts: ["2", "", "", "", ""], altGWord: "おやすみ" };
  assert.equal(shortcutText(key("F10"), s, false), "cast\n1");
  assert.equal(shortcutText(key("F8"), s, false), null);
  assert.equal(shortcutText(key("F8"), s, true), "2");
  assert.equal(shortcutText(key("KeyG", true), s, false), "おやすみ");
  assert.equal(shortcutText(key("F5"), s, false), null);
});
