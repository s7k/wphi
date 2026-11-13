// 右クリックで出すタグメニュー(tagMenu.ts)。選んだ項目で、textarea の選んだ文字をタグで囲む。
import { useEffect } from "react";
import { TAG_MENU, wrapTag, type TagItem } from "./tagMenu.ts";

/** textarea の選んだ文字を t で囲み、カーソルを置き直す */
export function applyTag(ta: HTMLTextAreaElement, t: TagItem, onInsert: (value: string) => void) {
  const r = wrapTag(ta.value, ta.selectionStart, ta.selectionEnd, t);
  onInsert(r.value);
  ta.focus();
  // React が value を書き戻した後にカーソルを置く
  requestAnimationFrame(() => ta.setSelectionRange(r.caret, r.caret));
}

export type TagMenuAt = { x: number; y: number; ta: HTMLTextAreaElement };

export function TagMenu(props: { at: TagMenuAt; onInsert: (value: string) => void; onClose: () => void }) {
  useEffect(() => {
    const close = () => props.onClose();
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  });
  const { ta } = props.at;
  return (
    <ul
      className="tag-menu"
      style={{ left: props.at.x, top: props.at.y }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") props.onClose();
      }}
    >
      {TAG_MENU.map((g) => (
        <li key={g.caption}>
          {g.caption}
          <ul>
            {g.items.map((t) => (
              <li
                key={t.caption}
                onClick={() => applyTag(ta, t, props.onInsert)}
              >
                {t.caption}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
