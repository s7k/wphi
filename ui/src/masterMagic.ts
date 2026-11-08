// 超魔法メニュー(Philly の MasterMagicMenu.xml と MainForm.cpp の MasterMagicMenu の実行)。#83
// マスター(経験値が 99999999)の時だけ出す。XML は設定フォルダ・Philly フォルダ・同梱の分の順に探す。

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

/** MasterMagicMenu.xml を読む。読めなければ null */
export function parseMasterMagic(xml: string): MasterMenu | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.querySelector("mastermagic");
  if (!root || doc.querySelector("parsererror")) return null;
  const text = (e: Element) => (e.textContent ?? "").replace(/&#xa;/g, "\n");
  const children = (e: Element, tag: string) => [...e.children].filter((c) => c.tagName === tag);
  return {
    caption: root.getAttribute("caption") ?? "超魔法",
    menus: children(root, "menu").map((m) => ({
      caption: m.getAttribute("caption") ?? "",
      items: children(m, "item").map((it): MasterItem => {
        const caption = it.getAttribute("caption") ?? "";
        if (caption === "-") return "-";
        const steps = [...it.children].flatMap((c): Step[] => {
          if (c.tagName === "send") return [{ send: text(c), noList: c.getAttribute("list") === "no" }];
          if (c.tagName === "ok_dialog") return [{ ok: text(c) }];
          if (c.tagName === "int_dialog") return [{ int: text(c) }];
          if (c.tagName === "string_dialog") return [{ string: text(c) }];
          return [];
        });
        return { caption, steps };
      }),
    })),
  };
}

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
