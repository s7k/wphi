// リスト(#list 〜 #end-list)の番号の扱い(Philly の Command.cpp ListModeSend と CharacterCommon.cpp classListMode)。
// サーバは続きのページ(9 の「続き」を選んだ後)を前のページの続きの番号で送る。1ページ目が 1〜9 なら 2ページ目は 9〜17。
// 画面の番号(1〜9)にページの先頭のずれ(ListOffset)を足した番号をサーバへ送る。
// 続きのページは前のページの下に足していく(Philly の classListMode::AddList。#84)。

export type ListState = {
  /** 溜めた全部の行。前のページの行も残す */
  lines: string[];
  checked: boolean[];
  cursor: number;
  /** 今のページの先頭の行の番号 - 1(Philly の ListOffset) */
  offset: number;
  /** 溜めた先頭の行の番号 - 1。溜めた中の i 番目の行の番号は start + i + 1 */
  start: number;
  /** 続きのページを頼んで、届くのを待っている。待つ間は 9 を受け付けない(Philly の More を落とす) */
  waiting?: boolean;
};

/** 届いたページからリストを作る。ずれは先頭の行の最初の数(Philly の AddList は /\d+/ で番号を取る) */
export function newList(lines: string[]): ListState {
  const first = /\d+/.exec(lines[0]?.replace(/\/\*.*?\*\//g, "") ?? "");
  const offset = first ? Math.max(Number(first[0]) - 1, 0) : 0;
  return { lines, checked: lines.map(() => false), cursor: 0, offset, start: offset };
}

/**
 * 届いたページを、前のリストの続きなら下に足す。前のリストの最後の行(9 番目の「続き」)は除く。
 * 続きでなければ(番号が繋がらなければ)新しいリストにする
 */
export function addPage(prev: ListState | null | undefined, lines: string[]): ListState {
  const page = newList(lines);
  if (!prev || page.offset + 1 !== prev.start + prev.lines.length || prev.lines.length === 0) return page;
  const kept = prev.lines.length - 1;
  return {
    lines: [...prev.lines.slice(0, kept), ...lines],
    checked: [...prev.checked.slice(0, kept), ...lines.map(() => false)],
    cursor: kept,
    offset: page.offset,
    start: prev.start,
  };
}

/** 今のページの先頭の行の、溜めた中の位置 */
export const pageTop = (l: ListState) => l.offset - l.start;

/** 今のページの行の数 */
const pageCount = (l: ListState) => l.lines.length - pageTop(l);

/** 9 件目は続きのページの印(Philly の SynchronizeShowList で No が 9 なら More) */
export const hasMore = (l: ListState) => pageCount(l) >= 9;

/** 続きのページを頼む番号 */
export const moreNo = (l: ListState) => String(l.offset + 9);

/** チェックした番号を空白区切りで。何もチェックしていなければカーソルの行の番号 */
export function listOk(l: ListState): string {
  const nos = l.checked.flatMap((c, i) => (c ? [String(l.start + i + 1)] : []));
  return nos.length > 0 ? nos.join(" ") : String(l.start + l.cursor + 1);
}

/**
 * 番号キー n(1〜9)を押した時。送る番号と、送った後にリストを閉じるか。
 * 9 は続きのページで、続きが無ければ何もしない。範囲外の番号は 0 と同じく取り消す。
 * Philly(ListEndTenKeyCertainly=on)は範囲外を OK にしてカーソルの行(ふつう1番)を送るが、
 * 装備が3つの時に unequip で 4 を押すと1番の武器を外してしまう。戦闘中は文字のキーでもリストを取り消すので、それに揃える
 */
export function listNo(l: ListState, n: number): { send: string; close: boolean } | null {
  if (n === 9) return hasMore(l) && !l.waiting ? { send: moreNo(l), close: false } : null;
  if (n > pageCount(l)) return { send: ".", close: true };
  return { send: String(l.offset + n), close: true };
}

/** カーソルを動かすか、カーソルの行のチェックを切り替えて次の行へ進む */
export function moveListCursor(l: ListState, a: { listCursor: -1 | 1 } | { listToggle: true }): ListState {
  const last = Math.max(l.lines.length - 1, 0);
  if ("listCursor" in a) return { ...l, cursor: Math.min(Math.max(l.cursor + a.listCursor, 0), last) };
  const checked = l.checked.map((c, i) => (i === l.cursor ? !c : c));
  return { ...l, checked, cursor: Math.min(l.cursor + 1, last) };
}

/** リストの受信の状態。cancel は次に届くリストを出さない数(Philly の NextListCancel) */
export type ListFlow = { cancel: number; started: boolean };

/**
 * list イベントを受けた時。#list と #end-list はどちらも active で届くので、交互に来る事で見分ける。
 * #end-list の時、空のリストと、NextListCancel の印がある分は出さない(Philly の RecvListEnd)。
 * 出すリストか、閉じる("close")か、何もしない(null)かを返す
 */
export function receiveList(
  flow: ListFlow,
  active: boolean,
  lines: string[] | undefined,
  prev?: ListState | null,
): ListState | "close" | null {
  if (!active) {
    flow.started = false;
    return "close";
  }
  if (!flow.started) {
    flow.started = true;
    return null;
  }
  flow.started = false;
  const cancel = flow.cancel > 0;
  if (cancel) flow.cancel--;
  if (!lines?.length || cancel) return null;
  return addPage(prev, lines);
}
