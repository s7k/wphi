// 超魔法メニュー (MainForm.cpp の MasterMagicMenu の実行)。#83
// マスター (経験値が 99999999) の時だけ出す。項目は DM のマスター専用の魔法
// (phidm-v6 の docs/gm/ops/admin-commands.md) から WPHI で起こした物で、Philly の MasterMagicMenu.xml は読まない。

/** 項目の手順。send は送る行(list が "no" なら、届くリストを出さない) */
export type Step =
  | { send: string; noList: boolean }
  | { ok: string }
  | { int: string }
  | { string: string };
export type MasterItem = { caption: string; steps: Step[] } | "-";
export type MasterMenu = { caption: string; menus: { caption: string; items: MasterItem[] }[] };

/** マスターの経験値(Philly の Character.cpp:283。v5y の #ulist も Master と出す) */
export const MASTER_EXP = 99999999;

/** cast の後に呪文を唱える。cast が出す魔法の一覧のリストは出さない */
const cast = (spell: string): Step[] => [
  { send: "cast", noList: true },
  { send: spell, noList: false },
];
const item = (caption: string, ...steps: Step[]): MasterItem => ({ caption, steps });
/** 呪文の名前をそのまま項目にする */
const plain = (spell: string): MasterItem => item(spell, ...cast(spell));
/** 確かめてから唱える */
const sure = (spell: string, message: string): MasterItem => item(spell, { ok: message }, ...cast(spell));
/** 対象のキャラの番号 (Master list の番号) を聞いて唱える */
const toNo = (caption: string, spell: string): MasterItem => item(caption, { int: "対象の番号 (Master list の番号)" }, ...cast(`${spell} %int`));
/** 唱えた後にサーバが聞く行を、先に聞いておいて続けて送る */
const thenLine = (spell: string, label: string): MasterItem => item(spell, { string: label }, ...cast(spell), { send: "%string", noList: false });
/** 引数を聞いて唱える */
const withArg = (spell: string, label: string): MasterItem => item(spell, { string: label }, ...cast(`${spell} %string`));

export const MASTER_MENU: MasterMenu = {
  caption: "超魔法",
  menus: [
    {
      caption: "プレイヤー",
      items: [
        plain("Master list"),
        "-",
        toNo("Jump", "Jump"),
        toNo("Draw", "Draw"),
        item("Basi Rurla", { string: "番号 x y" }, ...cast("Basi Rurla %string")),
        "-",
        toNo("Be Pygmalion", "Be Pygmalion"),
        item("Evil wind to", { int: "切断するキャラの番号 (Master list の番号)" }, { ok: "このキャラを保存して切断します。" }, ...cast("Evil wind to %int")),
        item("Brizzard from Cokyutos to", { string: "番号 分 (分を省くと 60 分。- ならキャラ ID も BAN)" }, ...cast("Brizzard from Cokyutos to %string")),
        thenLine("Close box of Pandora", "禁止するアドレスと分 (分を省くと無期限)"),
        thenLine("Open box of Pandora", "禁止を解くアドレス"),
        "-",
        plain("Deny PK"),
        plain("Permit PK"),
      ],
    },
    {
      caption: "移動と調査",
      items: [
        thenLine("Malor", "行き先の位置"),
        plain("Pass wall"),
        plain("Dumapic"),
        "-",
        plain("Eye of the Yog=Sothoth"),
        plain("Book of the Yog=Sothoth"),
        plain("Flag"),
        plain("Variable"),
      ],
    },
    {
      caption: "地形・アイテム・キャラ",
      items: [
        withArg("Resource", "目の前のマスの地形 (xx [zz])"),
        withArg("Createobj", "オブジェクトのデータ (phi.od の :O から座標を除いた物)"),
        sure("Eraseobj", "目の前のオブジェクトを消します。"),
        "-",
        withArg("Wish", "アイテムのデータ (:I 行の書式)"),
        plain("Dup"),
        plain("Cache"),
        "-",
        plain("Metamorphosis"),
        plain("Restoration"),
      ],
    },
    {
      caption: "読み直しと保存",
      items: [
        ...["td", "gate", "swt", "ban", "cmd", "fd", "crt", "ed", "ddx", "ex", "obj", "sd"].map((f) => plain(`Load ${f}`)),
        sure("Close gate", "世界間のゲートを閉じます。"),
        "-",
        plain("Save id"),
        plain("Save obj"),
      ],
    },
    {
      caption: "停止",
      items: [
        sure("Evil wind from Hyades", "全ての PC を保存して切断します (サーバは止めません)。"),
        sure("Evil wind from Malaika", "全ての PC を切断してから、サーバを止めます。"),
      ],
    },
  ],
};

/**
 * 項目の手順を前から順に実行する。send は次のダイアログの前にまとめて送り、list="no" の数だけリストを出さない。
 * ダイアログで取り消したら、残りは実行しない。%int・%string は直前のダイアログの答えに置き換える
 */
export async function runMasterItem(
  steps: Step[],
  io: {
    send: (lines: string[], cancelLists: number) => void;
    confirm: (message: string) => Promise<boolean>;
    ask: (label: string, numeric: boolean) => Promise<string | null>;
  },
) {
  let lines: string[] = [];
  let cancel = 0;
  let int = "";
  let str = "";
  const flush = () => {
    if (lines.length > 0) io.send(lines, cancel);
    lines = [];
    cancel = 0;
  };
  for (const s of steps) {
    if ("send" in s) {
      // 改行は送らない(Philly と同じ)
      lines.push(s.send.replaceAll("%string", str).replaceAll("%int", int).replace(/[\r\n]/g, ""));
      if (s.noList) cancel++;
      continue;
    }
    flush();
    if ("ok" in s) {
      if (!(await io.confirm(s.ok))) return;
    } else if ("int" in s) {
      const a = await io.ask(s.int, true);
      if (a === null || !/^-?\d+$/.test(a.trim())) return;
      int = a.trim();
    } else {
      const a = await io.ask(s.string, false);
      if (a === null) return;
      str = a;
    }
  }
  flush();
}
