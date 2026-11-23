// src-tauri/src/settings.rs の Settings。
import defaults from "./settings.default.json" with { type: "json" };

export type Settings = {
  fullKeyMove: boolean;
  /** F8〜F12。\n は改行 */
  shortcuts: string[];
  listShortcuts: string[];
  altGWord: string;
  /** ログに出てきた文字列で効果音を鳴らす(Philly.ini の SoundPlay) */
  soundPlay: boolean;
  /** ログを HTML で保存する。off ならテキスト */
  logSaveHtml: boolean;
  /** ログの行頭に時刻を出す(LogDispTime)。保存するログには off でも入れる */
  logDispTime: boolean;
  /** 発言と priv でタスクバーを点滅させる([TaskBarFlash] Enabled) */
  taskBarFlash: boolean;
  /** ログ欄のフォント。空なら既定のフォント */
  logFontName: string;
  /** ログ欄の文字の大きさ(px)。0 ならログの CSS に任せる(LogFontSize) */
  logFontSize: number;
  /** ログ欄からのコピーの仕方(Philly の [LogEdit]。#81) */
  logTagDeleteCopy: boolean;
  logTagDeleteAlways: boolean;
  logTimeDelete: boolean;
  logNameDelete: boolean;
  logTagCancel: boolean;
  /** 系統魔法の前に武器を外す(AutoUnequipSystemMagic) */
  autoUnequipSystemMagic: boolean;
  /** 系統魔法の後に外した武器を装備し直す(AutoEquipSystemMagic) */
  autoEquipSystemMagic: boolean;
  /** 超魔法メニューを、マスターでなくても出す(サーバの権限ファイルでマスターになった時) */
  masterMagicMenu: boolean;
  /** マップの拡大率(%)。v6 の地図に使う */
  mapZoom: number;
  /** v6 でない 7x7 の地図(v5y など)の拡大率(%)。0 なら mapZoom と同じ */
  mapZoomM57: number;
  /** スムーズ移動: 自分が進んだ時に地図を滑らかにずらす(設定の画面で切り替える) */
  smoothMove: boolean;
  /** スムーズ移動の歩き出しの重さ(-2 軽い 〜 0 標準 〜 2 重い。walker.ts の WEIGHTS) */
  smoothWeight: number;
  singleWindow: boolean;
  /** main 窓いっぱいにマップを出し、ログと入力欄を重ねる(モダン)。singleWindow より優先する */
  modern: boolean;
  /** マップの木と草に、場所で決まる揺らぎを付ける(drawMap.ts の origin) */
  mapVariety: boolean;
  /** マップのキャラの上に、発言の吹き出しと HP・MP の増減を出す(表示のメニュー) */
  mapEffects: boolean;
  /** 起動した時に、前回開いていたタブのキャラへ接続する */
  autoConnect: boolean;
  /** モダンの左上に出すステータス(HUD_STATS のキー) */
  hudStats: string[];
  /** 別のサーバの世界へ移る時に、キャラの ID を送ってよいか確かめる(#51) */
  confirmTransfer: boolean;
  /** 自動攻撃を止める自分の HP の割合 (%)。0 なら止めない */
  autoStopHp: number;
  /** キーもマウスも触らない時間がこの分を超えたら自動攻撃を止める。0 なら止めない */
  autoStopIdleMin: number;
};

/** モダンの左上に出せるステータス。設定の画面の並びと、出す順 */
export const HUD_STATS: [string, string][] = [
  ["hp", "HP"],
  ["mp", "MP"],
  ["exp", "経験値"],
  ["gp", "所持金"],
  ["lv", "レベル (Fighter・Wizard・Merchant・Creater)"],
];

/** 表示のメニューでチェックの付く項目を切り替えた時と、設定を保存した時に、Rust が設定の全体を全部の窓へ送る */
export const EXPERIMENT_EVENT = "phi-experiment";

/** 既定値は Rust の Settings::default() を書き出した物(settings.rs のテストが書き直す。#38) */
export const DEFAULT_SETTINGS: Settings = defaults;
// Rust の Settings と項目の名前が揃っているか。どちらかにしか無い項目があると、型検査で落ちる
type SameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false;
const sameKeys: SameKeys<typeof defaults, Settings> = true;
void sameKeys;

/** マップの拡大率(%)。ドットが崩れない整数倍だけ */
export const MAP_ZOOMS = [100, 200, 300] as const;
/** 拡大率(%)を、MAP_ZOOMS の一番近い値にする(同じ近さなら大きい方)。数でなければ 100 */
export const clampZoom = (z: number) =>
  Number.isFinite(z) ? MAP_ZOOMS.reduce((a, b) => (Math.abs(b - z) <= Math.abs(a - z) ? b : a)) : 100;

/** Philly.ini の文字列の \n を改行にする */
export const unescape = (s: string) => s.replace(/\\n/g, "\n");

/**
 * 設定で決まるキー(Command.cpp の ShortcutF08〜F12 と AltG)。送る文字列を返す。
 * リスト表示中の F8〜F12 はリスト用の文字列を送る(OtherShortCut)。
 */
export function shortcutText(
  e: Pick<KeyboardEvent, "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">,
  s: Settings,
  inList: boolean,
): string | null {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return null;
  if (e.altKey) return e.code === "KeyG" && s.altGWord ? unescape(s.altGWord) : null;
  const f = /^F(8|9|10|11|12)$/.exec(e.code);
  if (!f) return null;
  const text = (inList ? s.listShortcuts : s.shortcuts)[Number(f[1]) - 8];
  return text ? unescape(text) : null;
}

/** base から変えた項目の名前 */
export function changedKeys(base: Settings, edited: Settings): (keyof Settings)[] {
  return (Object.keys(edited) as (keyof Settings)[]).filter((k) => JSON.stringify(edited[k]) !== JSON.stringify(base[k]));
}

/**
 * 今の設定 current に、設定の画面で変えた項目 keys だけを edited から重ねる。
 * 写しを丸ごと保存すると、画面を開いている間に表示メニューで変えた値 (窓の形など) を元に戻した (#138)
 */
export function mergeChanged(current: Settings, edited: Settings, keys: (keyof Settings)[]): Settings {
  const next: Settings = { ...current };
  for (const k of keys) (next as Record<string, unknown>)[k] = edited[k];
  return next;
}
