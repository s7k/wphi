import assert from "node:assert/strict";
import { test } from "node:test";
import { changedKeys, clampZoom, DEFAULT_SETTINGS, mergeChanged, shortcutText } from "./settings.ts";

const key = (code: string, alt = false) => ({ code, shiftKey: false, ctrlKey: false, altKey: alt, metaKey: false });

test("F8〜F12 と Alt+G", () => {
  const s = { ...DEFAULT_SETTINGS, shortcuts: ["", "", "cast\\n1", "", ""], listShortcuts: ["2", "", "", "", ""], altGWord: "おやすみ" };
  assert.equal(shortcutText(key("F10"), s, false), "cast\n1");
  assert.equal(shortcutText(key("F8"), s, false), null);
  assert.equal(shortcutText(key("F8"), s, true), "2");
  assert.equal(shortcutText(key("KeyG", true), s, false), "おやすみ");
  assert.equal(shortcutText(key("F5"), s, false), null);
});

test("マップの拡大率は 100・200・300% の一番近い値にする", () => {
  assert.equal(clampZoom(100), 100);
  assert.equal(clampZoom(125), 100);
  assert.equal(clampZoom(150), 200);
  assert.equal(clampZoom(10), 100);
  assert.equal(clampZoom(1000), 300);
  assert.equal(clampZoom(NaN), 100);
});

test("設定の画面で変えた項目だけを、今の設定に重ねる (#138)", () => {
  const base = { ...DEFAULT_SETTINGS };
  const edited = { ...base, autoConnect: false, shortcuts: ["a", "", "", "", ""] };
  const keys = changedKeys(base, edited);
  assert.deepEqual(keys.sort(), ["autoConnect", "shortcuts"]);
  // 画面を開いている間に、表示メニューで窓の形を変えた
  const current = { ...base, modern: false };
  const next = mergeChanged(current, edited, keys);
  assert.equal(next.modern, false);
  assert.equal(next.autoConnect, false);
  assert.deepEqual(next.shortcuts, ["a", "", "", "", ""]);
  assert.deepEqual(changedKeys(base, base), []);
});
