// 右クリックで出すタグメニュー(tagMenu.ts)。選んだ項目で、textarea の選んだ文字をタグで囲む。
// OS のメニューで出す。HTML で作ると窓の中にしか出せず、窓の下の方の入力欄では項目が窓の外にはみ出て見えなかった
import { Menu } from "@tauri-apps/api/menu";
import { TAG_MENU, wrapTag, type TagItem } from "./tagMenu.ts";

/** textarea の選んだ文字を t で囲み、カーソルを置き直す */
export function applyTag(ta: HTMLTextAreaElement, t: TagItem, onInsert: (value: string) => void) {
  const r = wrapTag(ta.value, ta.selectionStart, ta.selectionEnd, t);
  onInsert(r.value);
  ta.focus();
  // React が value を書き戻した後にカーソルを置く
  requestAnimationFrame(() => ta.setSelectionRange(r.caret, r.caret));
}

/** マウスの位置にタグメニューを出す */
export async function popupTagMenu(ta: HTMLTextAreaElement, onInsert: (value: string) => void) {
  const menu = await Menu.new({
    items: TAG_MENU.map((g) => ({
      text: g.caption,
      items: g.items.map((t) => ({ text: t.caption, action: () => applyTag(ta, t, onInsert) })),
    })),
  });
  await menu.popup();
}
