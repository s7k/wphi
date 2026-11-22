// 看板の札 (SignCard) の見出しに出す、書いた人の名前と日付。
// サーバは看板を読む時、本文 (#more 〜 #end-more) の前に「名前 (日付)」の 1 行と、区切りの線の行を送る
// (phi_dm の phi_gateswitch.rs の load_sd の T と B)。名前は 15 文字で空白を詰め、日付は 70 バイト目で切るので、閉じ括弧が無い事がある

import { stripTags } from "./mapPop.ts";

/** 区切りの線の行 */
const RULE = /^-{10,}$/;
/** 「名前 (日付」。名前は空白を含みうるので、最後の " (" で分ける */
const HEAD = /^(.*\S)\s+\(([^)]*)\)?$/;

/**
 * #more の直前に届いた 2 行 (古い順) から、看板を書いた人と日付を取り出す。看板でない #more (お知らせ、一覧) なら null
 */
export function signAuthor(before: string[]): { name: string; date: string } | null {
  if (before.length < 2) return null;
  const [head, rule] = before.slice(-2).map((l) => stripTags(l).trim());
  if (!RULE.test(rule)) return null;
  const m = HEAD.exec(head);
  if (!m) return null;
  return { name: m[1], date: m[2].trim() };
}

/** 看板の札の為に読んでいる本文。#more で始め、#end-more で札にする */
export type SignReading = { lines: string[]; author: ReturnType<typeof signAuthor> };

/** #end-more が来ないまま続くと貯め続けるので、看板 1 枚の分に抑える (#120) */
export const SIGN_MAX_LINES = 500;

/** 読んでいる間に届いたログの行を足す */
export function signLine(reading: SignReading | undefined, html: string): void {
  if (reading && reading.lines.length < SIGN_MAX_LINES) reading.lines.push(html);
}

/**
 * #more (more = true) と #end-more (false) を受ける。recent は #more の直前に届いた 2 行。
 * 返す reading が次の状態で、card は札に出す物 (本文が空なら出さない)
 */
export function signMode(
  reading: SignReading | undefined,
  more: boolean,
  recent: string[],
): { reading: SignReading | undefined; card?: SignReading } {
  if (more && !reading) return { reading: { lines: [], author: signAuthor(recent) } };
  if (!more && reading) return { reading: undefined, card: reading.lines.length ? reading : undefined };
  return { reading };
}
