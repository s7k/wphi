// Philly のキー操作(Command.cpp の KeyBindNone / KeyBindShift / KeyBindCtrl と、
// CharacterCommon.cpp の classMoveCommand::GetMoveCommand)。
//
// Philly は入力欄の外(ログ欄・マップ窓など)にフォーカスがある時だけキーを操作に使う。
// キーは KeyboardEvent.code で判定する。key は IME やキー配列で値が変わる為である。
//
// 移動キーは moveInput で取り出し、押し続けた時の処理は moveRepeat.ts が行う。

/** 入力欄の外で押したキーに対する操作。 */
export type KeyAction =
  /**
   * confirm があれば、送る前に確認する(Philly の Call と Return)。
   * cancelList は、送った後に届くリストを出さない数(Philly の NextListCancel)。
   * cast と魔法の名前をまとめて送ると、サーバは cast の魔法の一覧を返してから魔法の名前を選択として受ける
   */
  | { send: string; confirm?: string; cancelList?: number }
  /** マップ窓の表示を切り替える(Shift+F5) */
  | { toggleMap: true }
  /** 支払い金額を聞いてから `pay <金額>` を送る */
  | { pay: true }
  /** 看板を書く。write を送り、看板エディタを開く(Command.cpp の Write) */
  | { write: true }
  /** 入力欄へフォーカスを移す */
  | { focusInput: true }
  | { nextTab: true };

/** キーを押した時の状態。 */
export type KeyContext = {
  /** 7x7 の北固定マップか。Philly は `ExMapSize57 && !ExMapStyleTurn` の時に北固定の移動にする */
  northFix: boolean;
  /** フルキーの 789 uio jkl m をテンキーとして使う(Philly.ini の FullKeyMove。Philly の既定は off、WPHI は on) */
  fullKeyMove: boolean;
};

export type Mods = "none" | "shift" | "ctrl";
type ActionMods = Mods | "alt" | "shiftAlt";

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
  KeyS: { write: true },
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
  End: { send: "unequip\n1", cancelList: 1 },
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
  // 所持魔法の1〜7番(FuncKeyMagicFix=off)。F8〜F12 は設定のショートカットなので設定画面と一緒に作る
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`F${n}`, { send: `cast\n${n}`, cancelList: 1 }])),
};

const SHIFT: Record<string, KeyAction> = {
  F5: { toggleMap: true },
  Space: { send: "hit" },
  KeyT: { send: "#ex-map style=solid" },
  Digit5: { send: "#ex-map size=40" },
  Numpad5: { send: "#ex-map size=40" },
  Digit7: { send: "#ex-map size=57" },
  Numpad7: { send: "#ex-map size=57" },
};

/** Alt(KeyBindAlt)。G(AltGWord)と S(看板の検索)は設定やダイアログが要るので後で作る */
const ALT: Record<string, KeyAction> = {
  KeyA: { send: "cast\nanalyze", cancelList: 1 },
  KeyB: {
    send: "cast\ncall", cancelList: 1,
    confirm: "現在の位置を call します。\nReturn や死んでしまって再接続するときはこの位置になります。\nよろしいですか？",
  },
  KeyC: { send: "cast\ncreate", cancelList: 1 },
  KeyD: { send: "cast\ndetect", cancelList: 1 },
  KeyE: { send: "cast\neagle eye", cancelList: 1 },
  KeyF: { send: "cast\nforget", cancelList: 1 },
  KeyI: { send: "cast\nidentify", cancelList: 1 },
  KeyL: { send: "cast\nwizard lock\nsee", cancelList: 1 },
  KeyP: { send: "cast\nparty eye", cancelList: 1 },
  KeyR: { send: "cast\nreturn", cancelList: 1, confirm: "call 位置に帰還します。\n持っているアイテムを失う可能性があります。\nよろしいですか？" },
  KeyU: { send: "cast\nunlock\nsee", cancelList: 1 },
  KeyW: { send: "cast\nwizard eye", cancelList: 1 },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`Digit${n}`, { send: `cast\n${n}`, cancelList: 1 }])),
};

/** Shift+Alt(KeyBindShiftAlt)。C・A・U は名前を聞くダイアログが要るので後で作る */
const SHIFT_ALT: Record<string, KeyAction> = {
  KeyW: { send: "cast\nwizard light", cancelList: 1 },
  KeyE: { send: "#ex-switch eagleeye=text\ncast\neagle eye\n#ex-switch eagleeye=form", cancelList: 1 },
  KeyL: { send: "cast\nlist", cancelList: 1 },
  KeyD: { send: "cast\ndestroy", cancelList: 1 },
};

const CTRL: Record<string, KeyAction> = {
  Numpad1: { send: "hit" },
  Numpad3: { send: "cast" },
  Space: { send: "hit" },
  Tab: { nextTab: true },
};

type KeyInput = Pick<KeyboardEvent, "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">;

function normalize(e: KeyInput, ctx: KeyContext): { code: string; mods: ActionMods } | null {
  if (e.metaKey || (e.ctrlKey && (e.shiftKey || e.altKey))) return null;
  const mods: ActionMods = e.altKey
    ? e.shiftKey
      ? "shiftAlt"
      : "alt"
    : e.shiftKey
      ? "shift"
      : e.ctrlKey
        ? "ctrl"
        : "none";
  // Philly は Alt 以外の時にフルキーをテンキーへ読み替える
  const code = ctx.fullKeyMove && !e.altKey ? (FULL_KEY_MOVE[e.code] ?? e.code) : e.code;
  return { code, mods };
}

/** 移動キーなら、そのキーと修飾キーを返す。Shift の 5 と 7 はマップの大きさを変えるので移動ではない */
export function moveInput(e: KeyInput, ctx: KeyContext): { key: MoveKey; mods: Mods } | null {
  const n = normalize(e, ctx);
  if (!n || n.mods === "alt" || n.mods === "shiftAlt" || (n.mods === "shift" && SHIFT[n.code])) return null;
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
  if (MOVE_KEYS[n.code] && n.mods !== "alt" && n.mods !== "shiftAlt") return null;
  const table = { none: NONE, shift: SHIFT, ctrl: CTRL, alt: ALT, shiftAlt: SHIFT_ALT }[n.mods];
  return table[n.code] ?? null;
}

/** リスト表示中のキー操作(Command.cpp の KeyBindListMode。修飾キーなしの時だけ) */
export type ListKeyAction =
  | { send: string }
  /** チェックした番号をまとめて送る */
  | { listOk: true }
  /** カーソルの行のチェックを切り替えて次の行へ */
  | { listToggle: true }
  | { listCursor: -1 | 1 }
  | { focusInput: true };

const LIST: Record<string, ListKeyAction> = {
  Digit0: { send: "." },
  Numpad0: { send: "." },
  Escape: { send: "." },
  Period: { send: "." },
  NumpadDecimal: { send: "." },
  ArrowLeft: { send: "." },
  ArrowRight: { send: "." },
  // すべて(ListAllSelectVK_ADD=on なのでテンキーは + を使う)
  NumpadAdd: { send: "-" },
  Minus: { send: "-" },
  Enter: { listOk: true },
  NumpadEnter: { listOk: true },
  Space: { listToggle: true },
  ArrowUp: { listCursor: -1 },
  ArrowDown: { listCursor: 1 },
  Tab: { focusInput: true },
};

/** リスト表示中のキー。リストの操作でなければ null(通常のキー操作へ回す) */
export function listKeyAction(e: KeyInput, ctx: KeyContext): ListKeyAction | null {
  const n = normalize(e, ctx);
  if (!n || n.mods !== "none") return null;
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(n.code);
  if (digit) return { send: digit[1] };
  return LIST[n.code] ?? null;
}

/** メニューバーの項目(src-tauri/src/menu.rs の id) → キーと同じ操作。設定とプリブは App が受け持つ */
export function menuAction(id: string): KeyAction | null {
  const send = (s: string): KeyAction => ({ send: s });
  const table: Record<string, KeyAction> = {
    get: NONE.KeyZ,
    put: NONE.KeyX,
    use: NONE.KeyC,
    sort: NONE.KeyV,
    floor: NONE.KeyF,
    read: NONE.KeyA,
    write: NONE.KeyS,
    erase: NONE.KeyD,
    board: NONE.KeyB,
    pay: NONE.KeyP,
    spells: NONE.KeyR,
    equip: NONE.KeyQ,
    unequip: NONE.KeyW,
    check: NONE.KeyM,
    skills: send("skills"),
    "wizard-eye": ALT.KeyW,
    "wizard-light": SHIFT_ALT.KeyW,
    list: SHIFT_ALT.KeyL,
    "eagle-eye": ALT.KeyE,
    identify: ALT.KeyI,
    "wizard-lock": ALT.KeyL,
    unlock: ALT.KeyU,
    detect: ALT.KeyD,
    create: ALT.KeyC,
    destroy: SHIFT_ALT.KeyD,
    analyze: ALT.KeyA,
    forget: ALT.KeyF,
    call: ALT.KeyB,
    return: ALT.KeyR,
    map: SHIFT.F5,
  };
  return table[id] ?? null;
}
