import assert from "node:assert/strict";
import { test } from "node:test";
import { listNo, listOk, moveListCursor, newList, receiveList, type ListFlow } from "./list.ts";

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
