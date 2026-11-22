// node --test ui/src/keys.test.ts で実行する(Node 24 は型を外して .ts を直接読む)
import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeTarget, keyAction, listKeyAction, menuAction, moveCommand, moveInput, stepCommands, type KeyContext } from "./keys.ts";

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
  // 5x5 の地図は無いので、Shift のテンキー5 も移動キー
  assert.deepEqual(act(key("Numpad5", { shift: true }), north), { send: "turn b" });
  assert.deepEqual(act(key("Tab", { ctrl: true }), north), { nextTab: true });
  assert.deepEqual(act(key("KeyW", { alt: true }), north), { send: "cast\nwizard eye", cancelList: 1, systemMagic: "reequip" });
  // Alt+数字は魔法の列の何番目か。Ctrl+数字には割り当てない
  assert.deepEqual(act(key("Digit3", { alt: true }), north), { spellSlot: 3 });
  assert.equal(act(key("Digit3", { ctrl: true }), north), null);
  assert.deepEqual(act(key("KeyL", { alt: true, shift: true }), north), { send: "cast\nlist", cancelList: 1, systemMagic: "reequip" });
  assert.ok((act(key("KeyR", { alt: true }), north) as { confirm?: string }).confirm);
  // F1〜F7 も魔法の列の何番目か (Alt+数字と同じ)
  assert.deepEqual(act(key("F3"), north), { spellSlot: 3 });
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
  // E はカバンを開く。フルキー移動の時も同じ (I はテンキーの 5 なので後ろを向く)
  assert.deepEqual(act(key("KeyE"), north), { menu: "bag-open" });
  assert.deepEqual(act(key("KeyE"), full), { menu: "bag-open" });
  assert.deepEqual(act(key("KeyI"), full), { send: "turn b" });
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
  // - とテンキーの + は全部の行にチェックを付ける (送らない)
  assert.deepEqual(listKeyAction(key("NumpadAdd"), north), { listAll: true });
  assert.deepEqual(listKeyAction(key("Minus"), north), { listAll: true });
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
  for (const id of ["search", "charge-spell", "appear", "disappear"]) assert.notEqual(menuAction(id), null, id);
  // 強制切断のキー(#77)
  assert.deepEqual(act(key("Pause"), north), { menu: "force-close" });
  assert.deepEqual(act(key("F1", { shift: true }), north), { menu: "force-close" });
  assert.deepEqual(act(key("Pause", { alt: true }), north), { menu: "all-force-close" });
  assert.deepEqual(menuAction("map-turn"), { send: "#ex-map style=turn" });
  assert.deepEqual(menuAction("map-solid"), { send: "#ex-map style=solid" });
  assert.ok((menuAction("return") as { confirm?: string }).confirm);
  assert.equal(menuAction("no-such"), null);
});

test("北固定の斜めは、縦を向きを変えない go n / go s にして横向きのまま歩く", () => {
  assert.deepEqual(stepCommands(["8", "6"], "none", true), ["go n", "go E"]);
  assert.deepEqual(stepCommands(["2", "4"], "none", true), ["go s", "go W"]);
  // 縦横 1 方向と、回転する地図はそのまま
  assert.deepEqual(stepCommands(["8"], "none", true), ["go N"]);
  assert.deepEqual(stepCommands(["8", "6"], "none", false), [moveCommand("8", "none", false), moveCommand("6", "none", false)]);
});

test("Esc は上に重なっている方から閉じ、何も開いていなければついて行くのをやめる", () => {
  assert.equal(escapeTarget({ bagOpen: true, sign: ["x"], privOpen: true }, true), "bag");
  assert.equal(escapeTarget({ partyOpen: true, sign: ["x"] }, false), "party");
  assert.equal(escapeTarget({ sign: ["x"], privOpen: true }, true), "sign");
  assert.equal(escapeTarget({ sign: null, privOpen: true }, true), "priv");
  assert.equal(escapeTarget({}, true), "follow");
  assert.equal(escapeTarget(undefined, false), null);
  assert.equal(escapeTarget({ target: { id: 1 } }, true), "follow");
  assert.equal(escapeTarget({ target: { id: 1 } }, false), "target");
});
