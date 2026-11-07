// 入力欄と看板エディタの右クリックのタグメニュー(Philly の Config/TagMenu.xml と MainForm.cpp の AddTagMenu)。
// 項目は Philly の既定の TagMenu.xml と同じ。選んだ文字をタグで囲む。

export type TagItem = { caption: string; tag: string; close: string };
export type TagGroup = { caption: string; items: TagItem[] };

const color = (name: string, key: string): TagItem => ({ caption: `${name}(${key})`, tag: `/*color=${name.toLowerCase()}*/`, close: "/*.*/" });

export const TAG_MENU: TagGroup[] = [
  {
    caption: "色タグ(C)",
    items: [
      { caption: "Custom(U)", tag: "/*color=#", close: "*//*.*/" },
      ...[
        ["Red", "R"], ["Blue", "B"], ["Cyan", "C"], ["Magenta", "M"], ["Navy", "N"], ["Lime", "L"], ["Purple", "P"],
        ["Yellow", "Y"], ["Silver", "S"], ["Olieve", "O"], ["Teal", "T"], ["Maroon", "A"], ["White", "W"],
        ["Green", "E"], ["Gray", "G"],
      ].map(([n, k]) => color(n, k)),
    ],
  },
  {
    caption: "サイズタグ(S)",
    items: [
      { caption: "Large(L)", tag: "/*size=large*/", close: "/*.*/" },
      { caption: "Small(S)", tag: "/*size=small*/", close: "/*.*/" },
    ],
  },
  {
    caption: "スタイルタグ(S)",
    items: ["Bold(B)", "Italic(I)", "Strike(S)", "Under(N)", "Sup(P)", "Sub(U)"].map((c) => ({
      caption: c,
      tag: `/*style=${c.split("(")[0].toLowerCase()}*/`,
      close: "/*.*/",
    })),
  },
  { caption: "フォントタグ(F)", items: [{ caption: "フォント種別(F)", tag: "/*font=", close: "*//*.*/" }] },
];

/**
 * 選んだ範囲(start〜end)をタグで囲む。カーソルは、閉じていないタグ(Custom・フォント)なら値を書く位置、
 * それ以外は囲んだ文字の後ろ
 */
export function wrapTag(value: string, start: number, end: number, t: TagItem): { value: string; caret: number } {
  const complete = t.tag.endsWith("*/");
  const next = value.slice(0, start) + t.tag + value.slice(start, end) + t.close + value.slice(end);
  const caret = complete ? start + t.tag.length + (end - start) + t.close.length : start + t.tag.length;
  return { value: next, caret };
}
