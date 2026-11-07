// Philly のキー操作(Command.cpp の KeyBindNone / KeyBindShift / KeyBindCtrl と、
// CharacterCommon.cpp の classMoveCommand::GetMoveCommand)。
//
// Philly は入力欄の外(ログ欄・マップ窓など)にフォーカスがある時だけキーを操作に使う。
// キーは KeyboardEvent.code で判定する。key は IME やキー配列で値が変わる為である。
//
// 移動キーは moveInput で取り出し、押し続けた時の処理は moveRepeat.ts が行う。

/** 入力欄の外で押したキーに対する操作。 */
export type KeyAction =
  | { send: string }
  /** 支払い金額を聞いてから `pay <金額>` を送る */
  | { pay: true }
  /** 入力欄へフォーカスを移す */
  | { focusInput: true }
  | { nextTab: true };

/** キーを押した時の状態。 */
export type KeyContext = {
  /** 7x7 の北固定マップか。Philly は `ExMapSize57 && !ExMapStyleTurn` の時に北固定の移動にする */
  northFix: boolean;
  /** フルキーの 789 uio jkl m をテンキーとして使う(Philly.ini の FullKeyMove。Philly の既定は off、rust-philly は on) */
  fullKeyMove: boolean;
};

export type Mods = "none" | "shift" | "ctrl";

/** テンキーと矢印キー → Philly の移動キー(Const.h の TMoveKeyNo) */
export type MoveKey = "2" | "4" | "5" | "6" | "7" | "8" | "9" | "up" | "down" | "left" | "right";

const MOVE_KEYS: Record<string, MoveKey> = {
  Numpad2: "2",
  Numpad4: "4",
  Numpad5: "5",
  Numpad6: "6",
  Numpad7: "7",
  Numpad8: "8",
  Numpad9: "9",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** フルキー → テンキー(Command.cpp の FullKeyMoveTranslate) */
const FULL_KEY_MOVE: Record<string, string> = {
  KeyM: "Numpad0",
  KeyJ: "Numpad1",
  KeyK: "Numpad2",
  KeyL: "Numpad3",
  KeyU: "Numpad4",
  KeyI: "Numpad5",
  KeyO: "Numpad6",
  Digit7: "Numpad7",
  Digit8: "Numpad8",
  Digit9: "Numpad9",
  Minus: "NumpadSubtract",
  Semicolon: "NumpadAdd",
  Slash: "NumpadDivide",
  Quote: "NumpadMultiply",
};

// 回転マップ(北固定でない時)。TurnModeCousorKeySwap(Philly の既定は on)で、
// 左右の矢印キーは Shift なしでカニ歩き、Shift ありで回転になる
const TURN: Record<Mods, Record<MoveKey, string>> = {
  none: {
    "2": "go b", "4": "go l", "5": "turn b", "6": "go r", "7": "turn l", "8": "go", "9": "turn r",
    down: "go b", up: "go", left: "go l", right: "go r",
  },
  shift: {
    "2": "go b", "4": "go l", "5": "turn b", "6": "go r", "7": "turn l", "8": "go", "9": "turn r",
    down: "go b", up: "go", left: "turn l", right: "turn r",
  },
  ctrl: {
    "2": "turn s", "4": "turn w", "5": "turn n", "6": "turn e", "7": "turn l", "8": "turn n", "9": "turn r",
    down: "turn s", up: "turn n", left: "turn w", right: "turn e",
  },
};

// 北固定マップ。Shift の矢印キーは向きに対する前後と回転、Ctrl は小文字の方角(向きを変えずに進む)
const NORTH_FIX: Record<Mods, Record<MoveKey, string>> = {
  none: {
    "2": "go S", "4": "go W", "5": "turn b", "6": "go E", "7": "turn l", "8": "go N", "9": "turn r",
    down: "go S", up: "go N", left: "go W", right: "go E",
  },
  shift: {
    "2": "go S", "4": "go W", "5": "turn b", "6": "go E", "7": "turn l", "8": "go N", "9": "turn r",
    down: "go b", up: "go", left: "turn l", right: "turn r",
  },
  ctrl: {
    "2": "go s", "4": "go w", "5": "turn b", "6": "go e", "7": "turn l", "8": "go n", "9": "turn r",
    down: "go s", up: "go n", left: "go w", right: "go e",
  },
};

/** 修飾キーなし(KeyBindNone)。移動以外 */
const NONE: Record<string, KeyAction> = {
  KeyA: { send: "read" },
  KeyB: { send: "board" },
  KeyC: { send: "use" },
  KeyD: { send: "erase" },
  KeyF: { send: "floor item" },
  KeyH: { send: "hi" },
  KeyM: { send: "check\nlook" },
  KeyN: { send: "n" },
  KeyP: { pay: true },
  KeyQ: { send: "equip" },
  KeyR: { send: "spells" },
  // ponytail: 看板の複数行入力(m-edit)の窓は P3。今は write を送るだけ
  KeyS: { send: "write" },
  KeyT: { send: "#ex-map style=turn" },
  KeyV: { send: "sort" },
  KeyW: { send: "unequip" },
  KeyX: { send: "put" },
  KeyY: { send: "y" },
  KeyZ: { send: "get" },
  Period: { send: "." },
  Space: { send: "hit" },
  // リストの番号。0 は取り消し
  Digit1: { send: "1" },
  Digit2: { send: "2" },
  Digit3: { send: "3" },
  Digit4: { send: "4" },
  Digit5: { send: "5" },
  Digit6: { send: "6" },
  Digit7: { send: "7" },
  Digit8: { send: "8" },
  Digit9: { send: "9" },
  Digit0: { send: "." },
  Tab: { focusInput: true },
  Home: { send: "equip\nsort" },
  End: { send: "unequip\n1" },
  // テンキーの移動以外
  Numpad0: { send: "check\nlook" },
  Numpad1: { send: "hit" },
  Numpad3: { send: "cast" },
  NumpadAdd: { send: "get" },
  NumpadSubtract: { send: "put" },
  NumpadEnter: { send: "cast" },
  NumpadDivide: { send: "equip" },
  NumpadMultiply: { send: "use" },
  NumpadDecimal: { send: "." },
};

const SHIFT: Record<string, KeyAction> = {
  Space: { send: "hit" },
  KeyT: { send: "#ex-map style=solid" },
  Digit5: { send: "#ex-map size=40" },
  Numpad5: { send: "#ex-map size=40" },
  Digit7: { send: "#ex-map size=57" },
  Numpad7: { send: "#ex-map size=57" },
};

const CTRL: Record<string, KeyAction> = {
  Numpad1: { send: "hit" },
  Numpad3: { send: "cast" },
  Space: { send: "hit" },
  Tab: { nextTab: true },
};

type KeyInput = Pick<KeyboardEvent, "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">;

function normalize(e: KeyInput, ctx: KeyContext): { code: string; mods: Mods } | null {
  if (e.altKey || e.metaKey || (e.shiftKey && e.ctrlKey)) return null;
  const mods: Mods = e.shiftKey ? "shift" : e.ctrlKey ? "ctrl" : "none";
  // Philly は Alt 以外の時にフルキーをテンキーへ読み替える
  const code = ctx.fullKeyMove ? (FULL_KEY_MOVE[e.code] ?? e.code) : e.code;
  return { code, mods };
}

/** 移動キーなら、そのキーと修飾キーを返す。Shift の 5 と 7 はマップの大きさを変えるので移動ではない */
export function moveInput(e: KeyInput, ctx: KeyContext): { key: MoveKey; mods: Mods } | null {
  const n = normalize(e, ctx);
  if (!n || (n.mods === "shift" && SHIFT[n.code])) return null;
  const key = MOVE_KEYS[n.code];
  return key ? { key, mods: n.mods } : null;
}

/** 移動キーのコマンド。go は進む、そうでなければ向きを変えるだけ(Philly の GetMoveCommand の戻り値 1 と 0) */
export function moveCommand(key: MoveKey, mods: Mods, northFix: boolean): { text: string; go: boolean } {
  const text = (northFix ? NORTH_FIX : TURN)[mods][key];
  return { text, go: text.startsWith("go") };
}

/** 入力欄の外で押したキーを、移動以外の操作にする。操作でなければ null。 */
export function keyAction(e: KeyInput, ctx: KeyContext): KeyAction | null {
  const n = normalize(e, ctx);
  if (!n) return null;
  if (n.mods === "shift" && SHIFT[n.code]) return SHIFT[n.code];
  if (MOVE_KEYS[n.code]) return null;
  return (n.mods === "none" ? NONE : n.mods === "ctrl" ? CTRL : {})[n.code] ?? null;
}
