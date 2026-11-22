// 魔法の列。覚えている呪文をアイコンで並べ、押すか Alt+数字で唱える (ui/src/spells.ts)。
// アイコンは効果 (EF_*) ごとのドット絵、背景の色は属性 (持ち物のタイルと同じ)。
// ドラッグか Shift+← / → で並べ替える。HTML5 のドラッグ＆ドロップは、Windows の Tauri が窓へのファイルのドロップを
// 受ける間は効かないので、ポインタの操作で作る
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ELEMENT_COLOR, Pixels } from "./BagPanel";
import { spellPixels } from "./pixelIcons.ts";
import type { Spell } from "./protocol";

/** これだけ動かしたらドラッグとみなす (px)。押しただけでは唱える */
const DRAG_PX = 6;

export function SpellBar(props: {
  spells: Spell[];
  waiting: boolean;
  onCast: (spell: Spell) => void;
  /** 列の from 番目を to 番目へ動かす */
  onMove: (from: number, to: number) => void;
}) {
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  // 押した所。dragging になったら、離した時に唱えずに並べ替える
  const press = useRef<{ from: number; x: number; dragging: boolean } | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  /** 直前の pointerup がドラッグだったか。続く click で唱えない */
  const dragged = useRef(false);
  // 動かした後にフォーカスを戻す呪文 (キーで並べ替えた時)
  const [focusName, setFocusName] = useState<string | null>(null);
  useEffect(() => {
    if (!focusName) return;
    tiles.current[props.spells.findIndex((s) => s.name === focusName)]?.focus();
    setFocusName(null);
  }, [props.spells, focusName]);

  if (!props.spells.length) return null;

  /** clientX の下のタイルの番号。端より外は端 */
  const indexAt = (x: number) => {
    const rects = tiles.current.map((t) => t?.getBoundingClientRect());
    const i = rects.findIndex((r) => r && x < r.right);
    return i < 0 ? props.spells.length - 1 : i;
  };
  const onDown = (i: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    press.current = { from: i, x: e.clientX, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDrag = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging && Math.abs(e.clientX - p.x) < DRAG_PX) return;
    p.dragging = true;
    setDrag({ from: p.from, over: indexAt(e.clientX) });
  };
  const onUp = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    press.current = null;
    setDrag(null);
    if (p?.dragging) {
      const to = indexAt(e.clientX);
      if (to !== p.from) props.onMove(p.from, to);
    }
  };
  const onClick = (s: Spell) => () => {
    // ドラッグで並べ替えた時は唱えない (pointerup の後に click が来る)
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    props.onCast(s);
  };
  const onKey = (i: number, s: Spell) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    // キーで選んだ時だけ並べ替える。クリックで唱えた後にフォーカスが残っていると、Shift+← → の向きを変える操作を奪った
    if (!e.currentTarget.matches(":focus-visible")) return;
    e.preventDefault();
    e.stopPropagation();
    const to = i + (e.key === "ArrowLeft" ? -1 : 1);
    if (to < 0 || to >= props.spells.length) return;
    setFocusName(s.name);
    props.onMove(i, to);
  };

  return (
    <div className="spell-bar" role="toolbar" aria-label="魔法 (ドラッグか Shift+← → で並べ替え)">
      {props.spells.map((s, i) => {
        const color = ELEMENT_COLOR[s.fn] ?? ELEMENT_COLOR[0];
        const cls = ["spell-tile", drag?.from === i ? "dragging" : "", drag && drag.over === i && drag.from !== i ? "drop-target" : ""];
        return (
          <button
            key={s.name}
            ref={(el) => {
              tiles.current[i] = el;
            }}
            type="button"
            className={cls.filter(Boolean).join(" ")}
            disabled={props.waiting}
            aria-label={i < 8 ? `${s.name} (Alt+${i + 1})` : s.name}
            style={color === "rainbow" ? { background: "conic-gradient(#c4482f, #c9a227, #3f9d8e, #3577c4, #7d5bc4, #c4482f)" } : { background: color }}
            onPointerDown={onDown(i)}
            onPointerMove={onDrag}
            onPointerUp={(e) => {
              dragged.current = !!press.current?.dragging;
              onUp(e);
            }}
            onPointerCancel={() => {
              press.current = null;
              setDrag(null);
            }}
            onClick={onClick(s)}
            onKeyDown={onKey(i, s)}
          >
            <Pixels rows={spellPixels(s.ef)} size={32} />
            {i < 8 && <span className="spell-key">{i + 1}</span>}
            {/* カーソルを当てるかキーで選ぶと、すぐ上に呪文の名前を出す */}
            <span className="spell-name">{s.name}</span>
          </button>
        );
      })}
    </div>
  );
}
