import assert from "node:assert/strict";
import { test } from "node:test";
import { addPage, hasMore, listNo, listOk, moveListCursor, newList, pageTop, receiveList, type ListFlow } from "./list.ts";

const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => `[${String(from + i).padStart(2)}] 品物${from + i}`);

test("1ページ目はそのままの番号を送る", () => {
  const l = newList(page(1, 9));
  assert.equal(l.offset, 0);
  assert.deepEqual(listNo(l, 3), { send: "3", close: true });
  assert.deepEqual(listNo(l, 9), { send: "9", close: false });
});

test("2ページ目以降は先頭のずれを足して送る(#43)", () => {
  const l = newList(page(9, 9));
  assert.equal(l.offset, 8);
  assert.deepEqual(listNo(l, 1), { send: "9", close: true });
  // 9 は 3ページ目を頼む 17
  assert.deepEqual(listNo(l, 9), { send: "17", close: false });
  // カーソルとチェックも番号をずらす
  assert.equal(listOk({ ...l, cursor: 8 }), "17");
  assert.equal(listOk({ ...l, checked: l.checked.map((_, i) => i === 0 || i === 2) }), "9 11");
});

test("最後のページ: 9 は何もせず、範囲外の番号は取り消す", () => {
  const l = newList(page(17, 3));
  assert.equal(listNo(l, 9), null);
  assert.deepEqual(listNo(l, 5), { send: ".", close: true });
  assert.deepEqual(listNo(l, 2), { send: "18", close: true });
});

test("リストの受信: #list と #end-list が交互に届き、NextListCancel の分と空のリストは出さない", () => {
  const flow: ListFlow = { cancel: 1, started: false };
  // 1つ目は取り消しの印がある
  assert.equal(receiveList(flow, true, undefined), null);
  assert.equal(receiveList(flow, true, ["[ 1] a"]), null);
  assert.equal(flow.cancel, 0);
  // 2つ目は出す
  assert.equal(receiveList(flow, true, undefined), null);
  assert.deepEqual(receiveList(flow, true, ["[ 1] a"]), newList(["[ 1] a"]));
  // 空のリストは出さない
  receiveList(flow, true, undefined);
  assert.equal(receiveList(flow, true, []), null);
  // 終わりの印は閉じて、次は始まりから数え直す
  receiveList(flow, true, undefined);
  assert.equal(receiveList(flow, false, undefined), "close");
  assert.equal(flow.started, false);
});

test("カーソルは端で止まり、Space はチェックを切り替えて次の行へ", () => {
  const l = newList(["[ 1] a", "[ 2] b"]);
  assert.equal(moveListCursor(l, { listCursor: -1 }).cursor, 0);
  assert.equal(moveListCursor({ ...l, cursor: 1 }, { listCursor: 1 }).cursor, 1);
  const t = moveListCursor(l, { listToggle: true });
  assert.deepEqual(t.checked, [true, false]);
  assert.equal(t.cursor, 1);
  assert.equal(moveListCursor(t, { listToggle: true }).cursor, 1);
});

test("続きのページは前のページの下に足し、1〜9 は今のページの中の番号のまま(#84)", () => {
  const p1 = newList(page(1, 9));
  const p2 = addPage({ ...p1, waiting: true }, page(9, 9));
  // 前のページの 9 番目(続き)を除いて足す
  assert.equal(p2.lines.length, 17);
  assert.equal(p2.lines[8], page(9, 1)[0]);
  assert.equal(pageTop(p2), 8);
  assert.equal(p2.cursor, 8);
  assert.equal(p2.waiting, undefined);
  assert.deepEqual(listNo(p2, 1), { send: "9", close: true });
  assert.deepEqual(listNo(p2, 9), { send: "17", close: false });
  // チェックは溜めた全部の行に付けられ、溜めた中の位置で番号を決める
  const checked = { ...p2, checked: p2.checked.map((_, i) => i === 0 || i === 10) };
  assert.equal(listOk(checked), "1 11");
  // 最後のページ: 範囲外は今のページの行の数で決める
  const p3 = addPage(p2, page(17, 3));
  assert.equal(p3.lines.length, 19);
  assert.equal(hasMore(p3), false);
  assert.deepEqual(listNo(p3, 3), { send: "19", close: true });
  assert.deepEqual(listNo(p3, 4), { send: ".", close: true });
});

test("番号が繋がらなければ新しいリストにする。待つ間は 9 を受け付けない", () => {
  const p1 = newList(page(1, 9));
  assert.equal(addPage(p1, page(1, 3)).lines.length, 3);
  assert.equal(listNo({ ...p1, waiting: true }, 9), null);
});
