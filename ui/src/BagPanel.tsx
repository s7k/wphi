// カバン。手持ちの 8 個(#v6 I)とインベントリ(#ex-inv)をアイコンで並べ、出し入れする。
// 行の書式は phi_dm の docs/dev/protocol-v6.md の「持ち物とインベントリ」。v6 で、世界が有効にしている時だけ届く
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { lightenColors } from "./logLines.ts";
import { Search, X } from "lucide-react";
import { PALETTE } from "./pixelIcons.ts";
import type { ItemInfo } from "./protocol";

/** 用途(IT_*)の番号 */
const IT = { armor: 1, weapon: 2, food: 3, resource: 4, jewel: 5, charge: 6, accessory: 7, spellJewel: 8, evently: 12, scroll: 13, currency: 14 };

/**
 * 持ち物とボタンの絵(itemIcons.png)。16x16 を横に並べた 1 枚で、武器の種類(WT_*)の 11 枚、用途(IT_*)の 10 枚、ステータスの札の順。
 * 絵は Shade(Kurt Gabriel Sotelo)の CC0 の素材から選び、拳・鞭・円刃・ステータスの札だけ同じ描き方で描いた。双剣は刀を左右反転して重ねた。
 * https://merchant-shade.itch.io/free-16x16-weapon-rpg-icons https://merchant-shade.itch.io/16x16-mixed-rpg-icons
 */
const ICONS_URL = new URL("./itemIcons.png", import.meta.url).href;
const ICON_COUNT = 22;
const WEAPON_COUNT = 11;
/** 背負い袋。用途が「その他」の持ち物と、カバンのボタン */
export const BAG_ICON = 20;
export const STATUS_ICON = 21;
/** 用途 → 絵の番号。無い用途は背負い袋 */
const ITEM_ICON: Partial<Record<number, number>> = {
  [IT.armor]: 11,
  [IT.food]: 12,
  [IT.resource]: 13,
  [IT.jewel]: 14,
  [IT.charge]: 15,
  [IT.accessory]: 16,
  [IT.spellJewel]: 17,
  [IT.scroll]: 18,
  [IT.currency]: 19,
};

const iconOf = (it: ItemInfo) =>
  it.it === IT.weapon ? (it.wt >= 0 && it.wt < WEAPON_COUNT ? it.wt : 1) : (ITEM_ICON[it.it] ?? BAG_ICON);

/** 持ち物の絵。ぼやけないよう pixelated で拡大する */
export function ItemIcon(props: { index: number; size: number }) {
  return (
    <span
      className="item-icon"
      style={{
        width: props.size,
        height: props.size,
        backgroundImage: `url(${ICONS_URL})`,
        backgroundSize: `${props.size * ICON_COUNT}px ${props.size}px`,
        backgroundPosition: `${-props.index * props.size}px 0`,
      }}
    />
  );
}

/** 16x16 のドット絵を、横に続く同じ色のドットを 1 つの四角にまとめた SVG で描く。ぼやけないよう crispEdges にする */
export function Pixels(props: { rows: string[]; size: number }) {
  const rects: React.ReactElement[] = [];
  // 床のアイテムの絵と同じく、足元に薄い影を落とす。一番下の行の幅に合わせ、その 1 ドット下に描く
  const bottom = props.rows.length - 1 - [...props.rows].reverse().findIndex((r) => /[^.]/.test(r));
  if (bottom >= 0 && bottom < props.rows.length && bottom < 15) {
    const r = props.rows[bottom];
    const [x0, x1] = [r.search(/[^.]/), r.length - 1 - [...r].reverse().findIndex((c) => c !== ".")];
    rects.push(<rect key="shadow" x={x0} y={bottom + 1} width={x1 - x0 + 1} height={1} fill="rgb(0 0 0 / 35%)" />);
  }
  props.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let w = 1;
      while (row[x + w] === c) w++;
      if (c !== ".") rects.push(<rect key={`${x},${y}`} x={x} y={y} width={w} height={1} fill={PALETTE[c]} />);
      x += w;
    }
  });
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      {rects}
    </svg>
  );
}

/** 属性(FN_*)の色。無・地・光・風・霊・水・火・鏡・プリズム・虹 */
const ELEMENT_COLOR = ["#59606a", "#9a6b3c", "#c9a227", "#3f9d8e", "#7d5bc4", "#3577c4", "#c4482f", "#8d98a6", "#c45aa8", "rainbow"];

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

/**
 * 手持ちの物の操作。use と put の番号は、空きを詰めて数えた何番目か(phi_dm の item_count)。
 * equip は名前で指し、まだ装備していない最初の物を装備する。unequip は装備中の物の一覧(武器・防具・その他の順)の番号で外す
 */
function handActions(hand: (ItemInfo | null)[], i: number): { label: string; send?: string; bag?: boolean; note?: string }[] {
  const it = hand[i]!;
  const no = hand.slice(0, i + 1).filter(Boolean).length;
  const equipped = !!EQUIP_LABEL[it.eq];
  const order = ["W", "A", "O"].filter((e) => hand.some((h) => h?.eq === e));
  const equipNo = order.indexOf(it.eq) + 1;
  return [
    { label: "使う", send: `use ${no}` },
    equipped
      ? { label: "外す", send: `unequip\n${equipNo}` }
      : { label: "装備する", send: `equip ${it.rawName || it.name}` },
    { label: "置く", send: equipped ? undefined : `put ${no}`, note: equipped ? "装備中の物は置けません" : undefined },
    { label: "カバンに入れる", bag: !equipped, note: equipped ? "装備中の物は入れられません" : undefined },
  ];
}

function Tile(props: { item: ItemInfo | null; selected: boolean; onClick?: () => void }) {
  const it = props.item;
  if (!it) return <div className="bag-tile empty" />;
  const color = ELEMENT_COLOR[it.fn] ?? ELEMENT_COLOR[0];
  return (
    <button
      type="button"
      className={props.selected ? "bag-tile selected" : "bag-tile"}
      style={color === "rainbow" ? { background: "conic-gradient(#c4482f, #c9a227, #3f9d8e, #3577c4, #7d5bc4, #c4482f)" } : { background: color }}
      title={[it.name, ...details(it)].join("\n")}
      onClick={props.onClick}
    >
      <ItemIcon index={iconOf(it)} size={48} />
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
  /** サーバへ1行か複数行を送る(use・equip・unequip・put) */
  onSend: (text: string) => void;
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
  const detail = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (detail.current) lightenColors(detail.current);
  }, [picked?.html]);
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
          <div className="bag-detail" ref={detail}>
            {/* html は phi-proto の tag_to_html がエスケープ済みで作ったもの。札と同じく色を白へ寄せる */}
            <div className="bag-name" data-line="name" key={picked.html} dangerouslySetInnerHTML={{ __html: picked.html }} />
            {details(picked).map((l) => (
              <div key={l}>{l}</div>
            ))}
            {sel.where === "hand" ? (
              <div className="bag-actions">
                {handActions(hand, sel.i).map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    disabled={!a.send && !a.bag}
                    title={a.note}
                    onClick={() => {
                      if (a.bag) props.onPut(sel.i + 1);
                      else if (a.send) props.onSend(a.send);
                      setSel(null);
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
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
