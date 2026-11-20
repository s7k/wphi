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
