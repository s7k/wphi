import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogWriter, logDate } from "./logSave.ts";

/** 呼ばれた順に記録し、resolve は手で呼ぶ append */
function fakeAppend() {
  const calls: { label: string; date: string; lines: string[]; asHtml: boolean }[] = [];
  const pending: (() => void)[] = [];
  const append = (args: (typeof calls)[number]) =>
    new Promise<string>((resolve) => {
      calls.push({ ...args, lines: [...args.lines] });
      pending.push(() => resolve(`${args.label}/${args.date}`));
    });
  return { append, calls, pending };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test("前の書き込みを待つ間に届いた行は、まとめて 1 回で書く。順番は届いた順", async () => {
  const f = fakeAppend();
  const save = createLogWriter(f.append);
  const a = save("Mirai", "1", true, "20261120");
  await flush();
  // 1 行目を書いている間に 2・3 行目が届く
  save("Mirai", "2", true, "20261120");
  const c = save("Mirai", "3", true, "20261120");
  assert.deepEqual(f.calls.map((x) => x.lines), [["1"]]);
  f.pending.shift()!();
  assert.equal(await a, "Mirai/20261120");
  await flush();
  assert.deepEqual(f.calls.map((x) => x.lines), [["1"], ["2", "3"]]);
  f.pending.shift()!();
  assert.equal(await c, "Mirai/20261120");
});

test("キャラ・日付・形式が違う行は、別の呼び出しにして順番を守る", async () => {
  const f = fakeAppend();
  const save = createLogWriter(f.append);
  save("Mirai", "1", true, "20261120");
  save("Kotone", "2", true, "20261120");
  save("Kotone", "3", false, "20261120");
  save("Kotone", "4", false, "20261121");
  for (let i = 0; i < 4; i++) {
    await flush();
    f.pending.shift()?.();
  }
  await flush();
  assert.deepEqual(
    f.calls.map((x) => `${x.label} ${x.date} ${x.asHtml} ${x.lines.join(",")}`),
    ["Mirai 20261120 true 1", "Kotone 20261120 true 2", "Kotone 20261120 false 3", "Kotone 20261121 false 4"],
  );
});

test("書き込みの失敗は知らせて、次の行は書く", async () => {
  const errors: unknown[] = [];
  let n = 0;
  const save = createLogWriter(async () => {
    if (n++ === 0) throw new Error("disk full");
    return "ok";
  }, (e) => errors.push(e));
  await save("Mirai", "1", true, "20261120");
  assert.equal(await save("Mirai", "2", true, "20261120"), "ok");
  assert.equal(errors.length, 1);
});

test("日付は YYYYMMDD", () => {
  assert.equal(logDate(new Date(2026, 0, 5)), "20260105");
});
