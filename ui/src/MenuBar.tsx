// macOS の窓の中のメニューバー。macOS は窓ごとのメニューを出さず、画面の上端にしか出せないので、
// 同じ項目(src-tauri/src/menu.rs の MENUS)を窓の中にも描く。選んだ項目は OS のメニューと同じに扱う(menu_select)
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

/** id が "-" なら区切り線、空なら押せない見出し(超魔法のサブメニューの名前) */
export type MenuModel = { name: string; items: { id: string; text: string; check: boolean }[] };

/** macOS か。WKWebView は navigator.platform に MacIntel を返す */
export const isMac = () => navigator.platform.startsWith("Mac");

/** 「設定(&S)...」の (&S) と & を除く。窓の中のメニューはアクセスキーを持たない */
export const menuLabel = (text: string) => text.replace(/\(&.\)/, "").replace("&", "");

export function MenuBar(props: { checked: (id: string) => boolean; extra?: MenuModel | null }) {
  const [model, setModel] = useState<MenuModel[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  // 登録したキャラが変わったら、「キャラクター」の項目を取り直す
  useEffect(() => {
    const load = () => invoke<MenuModel[]>("menu_model").then(setModel).catch(console.error);
    load();
    const unlisten = listen("phi-menu-changed", load);
    return () => {
      unlisten.then((f) => f());
    };
  }, []);
  // 開いている間は、外を押すか Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    // Esc はメニューを閉じるだけにし、リストの取り消しなどへ回さない
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(null);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  const select = (id: string) => {
    setOpen(null);
    invoke("menu_select", { id }).catch(console.error);
  };
  return (
    <div className="menu-bar" ref={bar}>
      {[...model, ...(props.extra ? [props.extra] : [])].map((m) => (
        <div key={m.name} className="menu-top">
          <button
            className={open === m.name ? "menu-title open" : "menu-title"}
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(open === m.name ? null : m.name);
            }}
            // 開いている時は、隣の項目へ動かすだけで開き直す
            onMouseEnter={() => open && open !== m.name && setOpen(m.name)}
          >
            {menuLabel(m.name)}
          </button>
          {open === m.name && (
            <div className="menu-drop">
              {m.items.map((it, i) =>
                it.id === "-" ? (
                  <hr key={i} />
                ) : it.id === "" ? (
                  <div key={i} className="menu-header">
                    {it.text}
                  </div>
                ) : (
                  <button key={it.id} className="menu-item" onClick={() => select(it.id)}>
                    <span className="menu-check">{it.check && props.checked(it.id) ? "✓" : ""}</span>
                    {menuLabel(it.text)}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
