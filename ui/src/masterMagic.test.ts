import assert from "node:assert/strict";
import { test } from "node:test";
import { MASTER_MENU, runMasterItem, type Step } from "./masterMagic.ts";

test("超魔法の手順: ダイアログの前にまとめて送り、答えで置き換え、取り消したら止める", async () => {
  const steps: Step[] = [
    { send: "cast", noList: true },
    { send: "list", noList: false },
    { int: "対象の No" },
    { send: "cast", noList: true },
    { send: "jump %int", noList: false },
  ];
  const sent: [string[], number][] = [];
  const io = (answer: string | null) => ({
    send: (lines: string[], n: number) => void sent.push([lines, n]),
    confirm: async () => true,
    ask: async () => answer,
  });
  await runMasterItem(steps, io("3"));
  assert.deepEqual(sent, [
    [["cast", "list"], 1],
    [["cast", "jump 3"], 1],
  ]);
  sent.length = 0;
  await runMasterItem(steps, io(null));
  assert.deepEqual(sent, [[["cast", "list"], 1]]);
  sent.length = 0;
  // 数でない答えも取り消しにする
  await runMasterItem(steps, io("abc"));
  assert.equal(sent.length, 1);
});

test("超魔法の項目: 番号を聞いて cast の後に唱え、後から聞く行は続けて送る", async () => {
  const find = (c: string) => MASTER_MENU.menus.flatMap((m) => m.items).find((it) => it !== "-" && it.caption === c) as { steps: Step[] };
  const run = async (c: string, answer: string) => {
    const sent: [string[], number][] = [];
    await runMasterItem(find(c).steps, { send: (l, n) => void sent.push([l, n]), confirm: async () => true, ask: async () => answer });
    return sent;
  };
  assert.deepEqual(await run("Jump", "3"), [[["cast", "Jump 3"], 1]]);
  assert.deepEqual(await run("Malor", "10 20"), [[["cast", "Malor", "10 20"], 1]]);
  assert.deepEqual(await run("Load swt", ""), [[["cast", "Load swt"], 1]]);
});
