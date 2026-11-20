// 魔法の列。覚えている呪文をアイコンで並べ、押すか Ctrl+数字で唱える (ui/src/spells.ts)。
// アイコンは効果 (EF_*) ごとのドット絵、背景の色は属性 (持ち物のタイルと同じ)
import { ELEMENT_COLOR, Pixels } from "./BagPanel";
import { spellPixels } from "./pixelIcons.ts";
import type { Spell } from "./protocol";

export function SpellBar(props: { spells: Spell[]; waiting: boolean; onCast: (spell: Spell) => void }) {
  if (!props.spells.length) return null;
  return (
    <div className="spell-bar" role="toolbar" aria-label="魔法">
      {props.spells.map((s, i) => {
        const color = ELEMENT_COLOR[s.fn] ?? ELEMENT_COLOR[0];
        return (
          <button
            key={s.name}
            type="button"
            className="spell-tile"
            disabled={props.waiting}
            aria-label={i < 8 ? `${s.name} (Ctrl+${i + 1})` : s.name}
            style={color === "rainbow" ? { background: "conic-gradient(#c4482f, #c9a227, #3f9d8e, #3577c4, #7d5bc4, #c4482f)" } : { background: color }}
            onClick={() => props.onCast(s)}
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
