// カバン。手持ちの 8 個(#v6 I)とインベントリ(#ex-inv)をアイコンで並べ、出し入れする。
// 行の書式は phi_dm の docs/dev/protocol-v6.md の「持ち物とインベントリ」。v6 で、世界が有効にしている時だけ届く
import { useMemo, useState } from "react";
import {
  Apple,
  Axe,
  Bone,
  BookOpen,
  Coins,
  Crosshair,
  Feather,
  Gem,
  Hammer,
  Hand,
  Package,
  ScrollText,
  Search,
  Shield,
  Slice,
  Sparkles,
  Sword,
  Swords,
  Target,
  Wand,
  Wind,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ItemInfo } from "./protocol";

/** 用途(IT_*)の番号 */
const IT = { armor: 1, weapon: 2, food: 3, resource: 4, jewel: 5, charge: 6, accessory: 7, spellJewel: 8, evently: 12, scroll: 13, currency: 14 };

/** 武器の種類(WT_*)の絵柄。拳・剣・刃・突き・槍・斧・打撃・鞭・牙・広範囲・周囲 */
const WEAPON_ICON: LucideIcon[] = [Hand, Sword, Slice, Crosshair, Wand, Axe, Hammer, Wind, Bone, Swords, Target];

/** 用途の絵柄。武器は WEAPON_ICON */
const ITEM_ICON: Partial<Record<number, LucideIcon>> = {
  [IT.armor]: Shield,
  [IT.food]: Apple,
  [IT.resource]: Package,
  [IT.jewel]: Gem,
  [IT.charge]: Zap,
  [IT.accessory]: Sparkles,
  [IT.spellJewel]: BookOpen,
  [IT.evently]: Feather,
  [IT.scroll]: ScrollText,
  [IT.currency]: Coins,
};

/** 属性(FN_*)の色。無・地・光・風・霊・水・火・鏡・プリズム・虹 */
const ELEMENT_COLOR = ["#59606a", "#9a6b3c", "#c9a227", "#3f9d8e", "#7d5bc4", "#3577c4", "#c4482f", "#8d98a6", "#c45aa8", "rainbow"];

const iconOf = (it: ItemInfo) => (it.it === IT.weapon ? (WEAPON_ICON[it.wt] ?? Sword) : (ITEM_ICON[it.it] ?? Package));

/** 装備の印の文字 */
const EQUIP_LABEL: Record<string, string> = { W: "武", A: "防", O: "装" };

/** カバンのタブ。用途で分ける */
const TABS: { label: string; match: (it: ItemInfo) => boolean }[] = [
  { label: "全部", match: () => true },
  { label: "武器", match: (it) => it.it === IT.weapon },
  { label: "防具", match: (it) => it.it === IT.armor },
  { label: "アクセサリー", match: (it) => it.it === IT.accessory },
  { label: "チャージ", match: (it) => it.it === IT.charge },
  {
    label: "その他",
    match: (it) => ![IT.weapon, IT.armor, IT.accessory, IT.charge].includes(it.it),
  },
];

/** 詳しい情報の行。数値の意味は用途で変わる(phi_magic/detect.rs の detect_item) */
function details(it: ItemInfo): string[] {
  const kind = it.it === IT.weapon ? `${it.type} / ${it.wtype}` : it.type;
  const lines = [`${kind}・${it.mat}・属性 ${it.elem}`, `攻撃力 ${it.op[0]}・重さ ${it.wp}`];
  if (it.it === IT.armor) lines.push(`防御率 ${it.op[1]}%・魔法防御率 ${it.op[2]}%`);
  if (it.it === IT.weapon) lines.push(`強化率 ${it.op[1]}%`);
  if (it.count !== undefined) lines.push(`残り ${it.count} 回`);
  if (it.ready > 0) lines.push(`使えるまで あと ${it.ready} 秒`);
  return lines;
}

function Tile(props: { item: ItemInfo | null; selected: boolean; onClick?: () => void }) {
  const it = props.item;
  if (!it) return <div className="bag-tile empty" />;
  const Icon = iconOf(it);
  const color = ELEMENT_COLOR[it.fn] ?? ELEMENT_COLOR[0];
  return (
    <button
      type="button"
      className={props.selected ? "bag-tile selected" : "bag-tile"}
      style={color === "rainbow" ? { background: "conic-gradient(#c4482f, #c9a227, #3f9d8e, #3577c4, #7d5bc4, #c4482f)" } : { background: color }}
      title={[it.name, ...details(it)].join("\n")}
      onClick={props.onClick}
    >
      <Icon size={26} strokeWidth={2} />
      {EQUIP_LABEL[it.eq] && <span className="bag-equip">{EQUIP_LABEL[it.eq]}</span>}
      {it.count !== undefined && <span className="bag-count">{it.count}</span>}
      {it.ready > 0 && <span className="bag-wait" />}
    </button>
  );
}

export function BagPanel(props: {
  /** 手持ちの枠(8 個。空きは null) */
  items: (ItemInfo | null)[];
  /** インベントリの中身。まだ届いていなければ null */
  bag: ItemInfo[] | null;
  message: string;
  onPut: (slot: number) => void;
  onGet: (no: number) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<{ where: "hand" | "bag"; i: number } | null>(null);
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState("");
  // 手持ちの枠は 8 個に揃える
  const hand = Array.from({ length: 8 }, (_, i) => props.items[i] ?? null);
  // カバンは番号(1 から)を保ったまま、タブと検索で絞る
  const shown = useMemo(
    () =>
      (props.bag ?? [])
        .map((it, i) => ({ it, no: i + 1 }))
        .filter(({ it }) => TABS[tab].match(it) && it.name.toLowerCase().includes(query.trim().toLowerCase())),
    [props.bag, tab, query],
  );
  const picked = sel?.where === "hand" ? hand[sel.i] : sel ? (props.bag?.[sel.i - 1] ?? null) : null;
  return (
    <div className="bag-panel" role="dialog" aria-label="カバン">
      <div className="sign-head">
        <span>カバン</span>
        <button type="button" title="閉じる(Esc)" onClick={props.onClose}>
          <X />
        </button>
      </div>
      <div className="bag-body">
        <div className="bag-title">手持ち</div>
        <div className="bag-grid">
          {hand.map((it, i) => (
            <Tile
              key={i}
              item={it}
              selected={sel?.where === "hand" && sel.i === i}
              onClick={() => setSel({ where: "hand", i })}
            />
          ))}
        </div>
        <div className="bag-title">カバンの中{props.bag ? ` (${props.bag.length})` : ""}</div>
        <div className="bag-tabs" role="tablist">
          {TABS.map((t, i) => (
            <button key={t.label} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)}>
              {t.label}
            </button>
          ))}
          <label className="bag-search">
            <Search size={14} />
            <input value={query} placeholder="名前で探す" onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
        <div className="bag-grid bag-store">
          {props.bag === null ? (
            <p className="bag-note">読み込み中...</p>
          ) : shown.length === 0 ? (
            <p className="bag-note">{props.bag.length ? "当てはまる物がありません" : "カバンは空です"}</p>
          ) : (
            shown.map(({ it, no }) => (
              <Tile key={no} item={it} selected={sel?.where === "bag" && sel.i === no} onClick={() => setSel({ where: "bag", i: no })} />
            ))
          )}
        </div>
        {picked && sel && (
          <div className="bag-detail">
            <div className="bag-name">{picked.name}</div>
            {details(picked).map((l) => (
              <div key={l}>{l}</div>
            ))}
            {sel.where === "hand" ? (
              <button
                type="button"
                disabled={!!EQUIP_LABEL[picked.eq]}
                onClick={() => {
                  props.onPut(sel.i + 1);
                  setSel(null);
                }}
              >
                {EQUIP_LABEL[picked.eq] ? "装備中は入れられません" : "カバンに入れる"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  props.onGet(sel.i);
                  setSel(null);
                }}
              >
                取り出す
              </button>
            )}
          </div>
        )}
        {props.message && <p className="bag-note">{props.message}</p>}
      </div>
    </div>
  );
}
