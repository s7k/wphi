// リスト(#list 〜 #end-list)の番号の扱い(Philly の Command.cpp ListModeSend と CharacterCommon.cpp classListMode)。
// サーバは続きのページ(9 の「続き」を選んだ後)を前のページの続きの番号で送る。1ページ目が 1〜9 なら 2ページ目は 9〜17。
// 画面の番号(1〜9)にページの先頭のずれ(ListOffset)を足した番号をサーバへ送る。

export type ListState = {
  lines: string[];
  checked: boolean[];
  cursor: number;
  /** ページの先頭の行の番号 - 1(Philly の ListOffset) */
  offset: number;
};

/** 届いたページからリストを作る。ずれは先頭の行の最初の数(Philly の AddList は /\d+/ で番号を取る) */
export function newList(lines: string[]): ListState {
  const first = /\d+/.exec(lines[0]?.replace(/\/\*.*?\*\//g, "") ?? "");
  const offset = first ? Math.max(Number(first[0]) - 1, 0) : 0;
  return { lines, checked: lines.map(() => false), cursor: 0, offset };
}

/** 9 件目は続きのページの印(Philly の SynchronizeShowList で No が 9 なら More) */
export const hasMore = (l: ListState) => l.lines.length >= 9;

/** 続きのページを頼む番号 */
export const moreNo = (l: ListState) => String(l.offset + 9);

/** チェックした番号を空白区切りで。何もチェックしていなければカーソルの行の番号 */
export function listOk(l: ListState): string {
  const nos = l.checked.flatMap((c, i) => (c ? [String(l.offset + i + 1)] : []));
  return nos.length > 0 ? nos.join(" ") : String(l.offset + l.cursor + 1);
}

/**
 * 番号キー n(1〜9)を押した時。送る番号と、送った後にリストを閉じるか。
 * 9 は続きのページで、続きが無ければ何もしない。範囲外の番号は OK を押した事にする(Philly.ini の ListEndTenKeyCertainly=on)
 */
export function listNo(l: ListState, n: number): { send: string; close: boolean } | { ok: true } | null {
  if (n === 9) return hasMore(l) ? { send: moreNo(l), close: false } : null;
  if (n > l.lines.length) return { ok: true };
  return { send: String(l.offset + n), close: true };
}
