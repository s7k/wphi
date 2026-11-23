// Philly のキー操作(Command.cpp の KeyBindNone / KeyBindShift / KeyBindCtrl と、
// CharacterCommon.cpp の classMoveCommand::GetMoveCommand)。
//
// Philly は入力欄の外(ログ欄・マップ窓など)にフォーカスがある時だけキーを操作に使う。
// キーは KeyboardEvent.code で判定する。key は IME やキー配列で値が変わる為である。
//
// 移動キーは moveInput で取り出す。押し続けた時は OS のキーリピートの keydown のたびに送る。

/** 入力欄の外で押したキーに対する操作。 */
export type KeyAction =
  /**
   * confirm があれば、送る前に確認する(Philly の Call と Return)。
   * cancelList は、送った後に届くリストを出さない数(Philly の NextListCancel)。
   * cast と魔法の名前をまとめて送ると、サーバは cast の魔法の一覧を返してから魔法の名前を選択として受ける。
   * systemMagic は系統魔法の印で、設定が on なら唱える前に武器を外す(Philly の AutoUnequipSystemMagic。#4)。
   * "reequip" は、設定が on なら唱えた後に装備し直す。"keep" は装備し直さない(唱えた後にリストが来る魔法)
   */
  | { send: string; confirm?: string; cancelList?: number; systemMagic?: "reequip" | "keep" }
  /** マップ窓の表示を切り替える(Shift+F5) */
  | { toggleMap: true }
  /**
   * 語や数を聞いてから、send の {} を答えに置き換えて送る(Philly の Pay・Search・Appear・Disappear)。
   * 答えが空なら送らない。numeric は数だけを受け付ける(Philly の IntInputDialog)
   */
  | { ask: AskOptions; send: string; cancelList?: number }
  /** 看板を書く。write を送り、看板エディタを開く(Command.cpp の Write) */
  | { write: true }
  /** 入力欄へフォーカスを移す */
  | { focusInput: true }
  | { nextTab: true }
  /** メニューの項目と同じ事をする(接続・切断など。App のメニューの処理に任せる) */
  | { menu: string }
  /** 魔法の列の n 番目 (1 から) を唱える (ui/src/spells.ts) */
  | { spellSlot: number };

/** initial は欄に初めから入れておく文字 */
export type AskOptions = { title: string; label: string; numeric?: boolean; initial?: string };

/** キーを押した時の状態。 */
export type KeyContext = {
  /** 北固定マップか。Philly は `ExMapSize57 && !ExMapStyleTurn` の時に北固定の移動にする */
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
  Pause: { menu: "force-close" },
  KeyA: { send: "read" },
  KeyB: { send: "board" },
  KeyC: { send: "use" },
  KeyD: { send: "erase" },
  KeyF: { send: "floor item" },
  // カバンを開く。I はフルキー移動 (既定でオン) の時に移動 (FULL_KEY_MOVE) が先に取り、効かなかった。E はどちらの設定でも空いている
  KeyE: { menu: "bag-open" },
  KeyH: { send: "hi" },
  KeyM: { send: "check\nlook" },
  KeyN: { send: "n" },
  KeyP: { ask: { title: "支払い金額", label: "支払う金額", numeric: true }, send: "pay {}" },
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
  // 魔法の列の左から 1〜7 番目 (Alt+数字と同じ)。魔法の列が無いサーバでは所持魔法の 1〜7 番 (Philly の FuncKeyMagicFix=off)。
  // サーバの番号のまま送ると、唱えるたびに番号が入れ替わって魔法の列と違う呪文になった。F8〜F12 は設定のショートカット
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`F${n}`, { spellSlot: n }])),
};

const SHIFT: Record<string, KeyAction> = {
  F5: { toggleMap: true },
  F1: { menu: "force-close" },
  Space: { send: "hit" },
  KeyT: { send: "#ex-map style=solid" },
  Digit7: { send: "#ex-map size=57" },
  Numpad7: { send: "#ex-map size=57" },
};

/** Alt(KeyBindAlt)。G(AltGWord)は設定の文字列なので shortcutText で扱う */
const ALT: Record<string, KeyAction> = {
  Pause: { menu: "all-force-close" },
  KeyA: { send: "cast\nanalyze", cancelList: 1, systemMagic: "keep" },
  KeyB: {
    send: "cast\ncall", cancelList: 1, systemMagic: "reequip",
    confirm: "現在の位置を call します。\nReturn や死んでしまって再接続するときはこの位置になります。\nよろしいですか？",
  },
  KeyC: { send: "cast\ncreate", cancelList: 1, systemMagic: "keep" },
  KeyD: { send: "cast\ndetect", cancelList: 1, systemMagic: "keep" },
  KeyE: { send: "cast\neagle eye", cancelList: 1, systemMagic: "reequip" },
  KeyF: { send: "cast\nforget", cancelList: 1, systemMagic: "keep" },
  KeyI: { send: "cast\nidentify", cancelList: 1, systemMagic: "reequip" },
  KeyL: { send: "cast\nwizard lock\nsee", cancelList: 1, systemMagic: "reequip" },
  KeyP: { send: "cast\nparty eye", cancelList: 1, systemMagic: "reequip" },
  KeyR: { send: "cast\nreturn", cancelList: 1, systemMagic: "reequip", confirm: "call 位置に帰還します。\n持っているアイテムを失う可能性があります。\nよろしいですか？" },
  KeyS: { ask: { title: "看板検索", label: "検索する言葉を入力してください" }, send: "cast\nsearch\n{}", cancelList: 1 },
  KeyU: { send: "cast\nunlock\nsee", cancelList: 1, systemMagic: "reequip" },
  KeyW: { send: "cast\nwizard eye", cancelList: 1, systemMagic: "reequip" },
  // 魔法の列の左から 1〜8 番目。並びは固定なので、唱えてサーバの番号が入れ替わっても同じ呪文 (ui/src/spells.ts)。
  // 魔法の列が無いサーバ (v6 でない世界) では、所持魔法の何番目かを唱える (App.tsx の castSpellSlot)。8 まで(Philly は 7 まで)
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`Digit${n}`, { spellSlot: n }])),
};

/** Shift+Alt(KeyBindShiftAlt) */
const SHIFT_ALT: Record<string, KeyAction> = {
  KeyW: { send: "cast\nwizard light", cancelList: 1, systemMagic: "reequip" },
  KeyE: { send: "#ex-switch eagleeye=text\ncast\neagle eye\n#ex-switch eagleeye=form", cancelList: 1, systemMagic: "reequip" },
  KeyL: { send: "cast\nlist", cancelList: 1, systemMagic: "reequip" },
  KeyD: { send: "cast\ndestroy", cancelList: 1, systemMagic: "keep" },
  KeyC: { send: "cast\ncharge spell", cancelList: 1, systemMagic: "keep" },
  KeyA: { ask: { title: "召喚", label: "召喚するNPCの名前を入力してください" }, send: "cast\nappear {}", cancelList: 1 },
  KeyU: { ask: { title: "送喚", label: "送喚するNPCの名前を入力してください" }, send: "cast\ndisappear {}", cancelList: 1 },
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

/** 移動キーなら、そのキーと修飾キーを返す。Shift の 7 はマップの大きさを変えるので移動ではない */
export function moveInput(e: KeyInput, ctx: KeyContext): { key: MoveKey; mods: Mods } | null {
  const n = normalize(e, ctx);
  if (!n || n.mods === "alt" || n.mods === "shiftAlt" || (n.mods === "shift" && SHIFT[n.code])) return null;
  const key = MOVE_KEYS[n.code];
  return key ? { key, mods: n.mods } : null;
}

/** 移動キーのコマンド。go は進む、そうでなければ向きを変えるだけ(Philly の GetMoveCommand の戻り値 1 と 0) */
export function moveCommand(key: MoveKey, mods: Mods, northFix: boolean): string {
  return (northFix ? NORTH_FIX : TURN)[mods][key];
}

/**
 * 1 歩 (斜めなら縦と横の 2 行) のコマンド。北固定の斜めは、縦の 1 行を向きを変えない go n / go s (Ctrl の移動) にし、
 * 横を向いたまま歩く。縦も go N / go S で送ると、1 歩ごとに上下と左右を交互に向いた
 */
export function stepCommands(keys: MoveKey[], mods: Mods, northFix: boolean, diagLine = false): string[] {
  const diagonal = northFix && mods === "none" && keys.length > 1;
  // 斜めの 1 行を受けるサーバ (#ex-switch move=diag。#196) には、北東などを 1 行で送る。縦横と同じ速さで歩ける
  if (diagonal && diagLine && keys.length === 2) {
    const ns = keys.some((k) => k === "8" || k === "up") ? "n" : keys.some((k) => k === "2" || k === "down") ? "s" : "";
    const ew = keys.some((k) => k === "6" || k === "right") ? "e" : keys.some((k) => k === "4" || k === "left") ? "w" : "";
    if (ns && ew) return [`go ${ns}${ew}`];
  }
  const vertical = (k: MoveKey) => k === "8" || k === "2" || k === "up" || k === "down";
  return keys.map((k) => moveCommand(k, diagonal && vertical(k) ? "ctrl" : mods, northFix));
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
  /** 番号(1〜9)。送る番号はページのずれを足して決める(list.ts の listNo) */
  | { listNo: number }
  /** チェックした番号をまとめて送る */
  | { listOk: true }
  /** カーソルの行のチェックを切り替えて次の行へ */
  | { listToggle: true }
  /** 全部の行のチェックを付けるか外す (list.ts の checkAll) */
  | { listAll: true }
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
  // すべて(ListAllSelectVK_ADD=on なのでテンキーは + を使う)。Philly は - を送ってすぐ閉じるが、WPHI は全部の行に
  // チェックを付けて、Enter で選んだ番号を送る (get / put で 1〜8 を全部選ぶ)
  NumpadAdd: { listAll: true },
  Minus: { listAll: true },
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
  if (digit) return { listNo: Number(digit[1]) };
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
    search: ALT.KeyS,
    "charge-spell": SHIFT_ALT.KeyC,
    appear: SHIFT_ALT.KeyA,
    disappear: SHIFT_ALT.KeyU,
    call: ALT.KeyB,
    return: ALT.KeyR,
    map: SHIFT.F5,
    "map-turn": NONE.KeyT,
    "map-solid": SHIFT.KeyT,
  };
  return table[id] ?? null;
}

/** Esc で閉じる物 */
export type EscapeTarget = "bag" | "talk" | "shop" | "party" | "sign" | "priv" | "follow" | "target";

/**
 * Esc で閉じる物を、上に重なっている方から選ぶ (カバン 11、札 6)。
 * 札を先に閉じていた為、両方開いていると見えているカバンでなく裏の札が閉じた。画面が開いていなければ、ついて行くのをやめる
 */
export function escapeTarget(
  open: { bagOpen?: boolean; partyOpen?: boolean; sign?: unknown; privOpen?: boolean; target?: unknown; shop?: unknown; talk?: unknown } | undefined,
  following: boolean,
): EscapeTarget | null {
  if (open?.bagOpen) return "bag";
  if (open?.talk) return "talk";
  if (open?.shop) return "shop";
  if (open?.partyOpen) return "party";
  if (open?.sign) return "sign";
  if (open?.privOpen) return "priv";
  if (following) return "follow";
  // 最後に対象を外す (#183)
  return open?.target ? "target" : null;
}
