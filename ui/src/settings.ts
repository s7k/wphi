// src-tauri/src/settings.rs の Settings。
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
  /** マップの拡大率(%) */
  mapZoom: number;
  /** 実験的: 自分が進んだ時に地図を滑らかにずらす(表示のメニューで切り替える) */
  smoothMove: boolean;
  /** 拡張マップ。付属して位置を予想し、長押しのリピートを制御する。off なら 7x7 だけでリピートは OS 任せ(表示のメニュー) */
  automap: boolean;
};

/** 表示のメニューでチェックの付く項目を切り替えた時と、設定を保存した時に、Rust が設定の全体を全部の窓へ送る */
export const EXPERIMENT_EVENT = "phi-experiment";

export const DEFAULT_SETTINGS: Settings = {
  fullKeyMove: true,
  shortcuts: ["", "", "", "", ""],
  listShortcuts: ["", "", "", "", ""],
  altGWord: "",
  soundPlay: true,
  logSaveHtml: true,
  mapZoom: 100,
  smoothMove: false,
  automap: true,
};

export const MAP_ZOOM_MIN = 50;
export const MAP_ZOOM_MAX = 400;
/** 拡大率(%)を、扱える範囲の整数にする。数でなければ 100 */
export const clampZoom = (z: number) =>
  Number.isFinite(z) ? Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, Math.round(z))) : 100;

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
