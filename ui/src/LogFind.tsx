// ログの検索(Ctrl+F)。Tauri の WebView にはブラウザの検索窓が無いので作る。
// ログ欄の行(data-line)の文字を大文字小文字を区別せずに探し、当たった行に印を付けて、今の行へスクロールする。
// 探すのはログ欄に残っている行だけ(古い行は pushLines で捨てている)
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { LogLine } from "./logLines.ts";

const HIT = "find-hit";
const CURRENT = "find-current";

export function LogFind(props: { log: () => HTMLElement | null; lines: LogLine[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<HTMLElement[]>([]);
  // 今の行。新しい行が届いても同じ行に留まる
  const [current, setCurrent] = useState<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);

  useEffect(() => {
    const q = query.toLowerCase();
    const all = [...(props.log()?.querySelectorAll<HTMLElement>("[data-line]") ?? [])];
    const found = q ? all.filter((el) => (el.textContent ?? "").toLowerCase().includes(q)) : [];
    for (const el of all) el.classList.toggle(HIT, found.includes(el));
    setHits(found);
    // 最初は一番新しい行
    setCurrent((c) => (c && found.includes(c) ? c : (found.at(-1) ?? null)));
    return () => all.forEach((el) => el.classList.remove(HIT));
  }, [query, props.lines]);

  useEffect(() => {
    if (!current) return;
    current.classList.add(CURRENT);
    current.scrollIntoView({ block: "center" });
    return () => current.classList.remove(CURRENT);
  }, [current]);

  const at = current ? hits.indexOf(current) : -1;
  // d が -1 なら古い方、1 なら新しい方。端まで行ったら反対の端へ
  const step = (d: number) => hits.length && setCurrent(hits[(at + d + hits.length) % hits.length]);
  return (
    <div className="log-find">
      <input
        ref={input}
        value={query}
        placeholder="ログを検索"
        onChange={(e) => {
          setQuery(e.target.value);
          setCurrent(null);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") step(e.shiftKey ? 1 : -1);
          else if (e.key === "Escape") props.onClose();
          else return;
          e.preventDefault();
        }}
      />
      <span className="log-find-count">{query ? `${at + 1}/${hits.length}` : ""}</span>
      <button title="前(古い方)へ Enter" onClick={() => step(-1)}>
        <ChevronUp />
      </button>
      <button title="次(新しい方)へ Shift+Enter" onClick={() => step(1)}>
        <ChevronDown />
      </button>
      <button title="閉じる Esc" onClick={props.onClose}>
        <X />
      </button>
    </div>
  );
}
