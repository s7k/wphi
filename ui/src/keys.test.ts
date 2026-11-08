// node --test ui/src/keys.test.ts で実行する(Node 24 は型を外して .ts を直接読む)
import assert from "node:assert/strict";
import { test } from "node:test";
import { keyAction, listKeyAction, menuAction, moveCommand, moveInput, type KeyContext } from "./keys.ts";

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
  return m ? { send: moveCommand(m.key, m.mods, ctx.northFix) } : keyAction(e, ctx);
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
  assert.deepEqual(act(key("KeyP"), north), { ask: { title: "支払い金額", label: "支払う金額", numeric: true }, send: "pay {}" });
  assert.deepEqual(act(key("KeyT", { shift: true }), north), { send: "#ex-map style=solid" });
  assert.deepEqual(act(key("Digit5", { shift: true }), north), { send: "#ex-map size=40" });
  assert.deepEqual(act(key("Tab", { ctrl: true }), north), { nextTab: true });
  assert.deepEqual(act(key("KeyW", { alt: true }), north), { send: "cast\nwizard eye", cancelList: 1, systemMagic: "reequip" });
  assert.deepEqual(act(key("Digit3", { alt: true }), north), { send: "cast\n3", cancelList: 1 });
  assert.deepEqual(act(key("KeyL", { alt: true, shift: true }), north), { send: "cast\nlist", cancelList: 1, systemMagic: "reequip" });
  assert.ok((act(key("KeyR", { alt: true }), north) as { confirm?: string }).confirm);
  assert.deepEqual(act(key("F3"), north), { send: "cast\n3", cancelList: 1 });
  assert.deepEqual(act(key("F5", { shift: true }), north), { toggleMap: true });
  // Alt の時はフルキー移動の読み替えをしない
  assert.deepEqual(act(key("KeyU", { alt: true }), { northFix: true, fullKeyMove: true }), { send: "cast\nunlock\nsee", cancelList: 1, systemMagic: "reequip" });
  // Alt と矢印は移動にしない
  assert.equal(act(key("ArrowUp", { alt: true }), north), null);
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

test("リスト表示中のキー", () => {
  const full = { northFix: true, fullKeyMove: true };
  assert.deepEqual(listKeyAction(key("Digit3"), north), { listNo: 3 });
  assert.deepEqual(listKeyAction(key("Numpad9"), north), { listNo: 9 });
  // フルキー移動の 7・8 はリスト表示中は番号(移動より先に見る)
  assert.deepEqual(listKeyAction(key("Digit7"), full), { listNo: 7 });
  assert.deepEqual(listKeyAction(key("Digit8"), full), { listNo: 8 });
  // フルキー移動の k はテンキーの 2 なので番号の 2
  assert.deepEqual(listKeyAction(key("KeyK"), full), { listNo: 2 });
  assert.deepEqual(listKeyAction(key("Escape"), north), { send: "." });
  assert.deepEqual(listKeyAction(key("NumpadAdd"), north), { send: "-" });
  assert.deepEqual(listKeyAction(key("Space"), north), { listToggle: true });
  assert.deepEqual(listKeyAction(key("ArrowDown"), north), { listCursor: 1 });
  // 修飾キー付きと、リストに関係ないキーは通常のキー操作へ回す
  assert.equal(listKeyAction(key("Digit3", { shift: true }), north), null);
  assert.equal(listKeyAction(key("KeyQ"), north), null);
});

test("メニューの項目", () => {
  assert.deepEqual(menuAction("get"), { send: "get" });
  assert.deepEqual(menuAction("wizard-eye"), { send: "cast\nwizard eye", cancelList: 1, systemMagic: "reequip" });
  assert.deepEqual(menuAction("map"), { toggleMap: true });
  assert.deepEqual(menuAction("map-turn"), { send: "#ex-map style=turn" });
  assert.deepEqual(menuAction("map-solid"), { send: "#ex-map style=solid" });
  assert.ok((menuAction("return") as { confirm?: string }).confirm);
  assert.equal(menuAction("no-such"), null);
});
