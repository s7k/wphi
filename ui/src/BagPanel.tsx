// カバン。手持ちの 8 個(#v6 I)とインベントリ(#ex-inv)をアイコンで並べ、出し入れする。
// 行の書式は phi_dm の docs/dev/protocol-v6.md の「持ち物とインベントリ」。v6 で、世界が有効にしている時だけ届く
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

/**
 * カバンの中を 1 ページに並べる数。品が 85 個のカバンを開くと Windows の窓全体が固まり、OS ごとメモリを食い尽くした。
 * 原因は未特定で、Linux の Chromium では再現しない。並べるタイルの数を品の数に依らず抑える
 */
const PAGE = 40;

/** 属性(FN_*)の色。無・地・光・風・霊・水・火・鏡・プリズム・虹 */
export const ELEMENT_COLOR = ["#59606a", "#9a6b3c", "#c9a227", "#3f9d8e", "#7d5bc4", "#3577c4", "#c4482f", "#8d98a6", "#c45aa8", "rainbow"];

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

/** 詳しい情報の行。数値の意味は用途で変わる(phi_dm の phi_magic/detect.rs の detect_item。ER・Effect・S.E. は Detect の呼び名) */
function details(it: ItemInfo): string[] {
  const kind = it.it === IT.weapon ? `${it.type} / ${it.wtype}` : it.type;
  const lines = [`${kind}・${it.mat}・属性 ${it.elem}`, `攻撃力 ${it.op[0]}・重さ ${it.wp}`];
  if (it.it === IT.armor) lines.push(`防御率 ${it.op[1]}%・魔法防御率 ${it.op[2]}%`);
  if (it.it === IT.weapon) lines.push(`ER ${it.op[1]}%`);
  if (it.effect !== undefined) lines.push(`Effect ${it.effect}`);
  if (it.se !== undefined) lines.push(`${it.curse ? "Curse" : "S.E."} ${it.se}`);
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

/** 選んだ物の名前を、同じ名前は「×数」にまとめて並べる */
function pickedNames(bag: ItemInfo[], nos: Set<number>): string {
  const count = new Map<string, number>();
  for (const no of [...nos].sort((a, b) => a - b)) {
    const name = bag[no - 1]?.name;
    if (name) count.set(name, (count.get(name) ?? 0) + 1);
  }
  return [...count].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join("、");
}

/** 番号の大きい順。1 つ送るたびに、それより後ろの番号が 1 つずつ詰まる為 */
const descending = (nos: Set<number>) => [...nos].sort((a, b) => b - a);

function Tile(props: { item: ItemInfo | null; selected: boolean; onClick?: () => void; checked?: boolean }) {
  const it = props.item;
  if (!it) return <div className="bag-tile empty" />;
  const color = ELEMENT_COLOR[it.fn] ?? ELEMENT_COLOR[0];
  return (
    <button
      type="button"
      className={props.selected ? "bag-tile selected" : "bag-tile"}
      style={color === "rainbow" ? { background: "conic-gradient(#c4482f, #c9a227, #3f9d8e, #3577c4, #7d5bc4, #c4482f)" } : { background: color }}
      title={[it.name, ...details(it)].join("\n")}
      aria-pressed={props.checked}
      onClick={props.onClick}
    >
      {props.checked !== undefined && <span className={props.checked ? "bag-check checked" : "bag-check"} aria-hidden="true" />}
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
  /** カバンの no 番の物と同じ名前の物を count 個、足元へ置く (#ex-inv drop) */
  onDrop: (no: number, count: number) => void;
  /** 足元のスイッチ (店の買い取り) が受け取る物を、カバンと手持ちから全部置く (#ex-inv offer) */
  onOffer: () => void;
  /** カバンの番号 (1 から) の物をまとめて扱う。番号の大きい順に並べてある (送るたびに後ろの番号が詰まらない様に) */
  onDropMany: (nos: number[]) => void;
  onGetMany: (nos: number[]) => void;
  /** サーバへ1行か複数行を送る(use・equip・unequip・put) */
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<{ where: "hand" | "bag"; i: number } | null>(null);
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  // 選択モード。カバンの番号 (1 から) の集合。null なら選択モードでない
  const [checked, setChecked] = useState<Set<number> | null>(null);
  // カバンの中身が届き直すと番号がずれるので、選択をやめる
  useEffect(() => setChecked(null), [props.bag]);
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
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const free = hand.filter((h) => !h).length;
  const picked = sel?.where === "hand" ? hand[sel.i] : sel ? (props.bag?.[sel.i - 1] ?? null) : null;
  // カバンの中の、選んだ物と同じ名前の物の数 (drop の個数)
  const nameOf = (it: ItemInfo) => it.rawName || it.name;
  const same = sel?.where === "bag" && picked ? (props.bag ?? []).filter((it) => nameOf(it) === nameOf(picked)).length : 0;
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
        <div className="bag-title">
          カバンの中{props.bag ? ` (${props.bag.length})` : ""}
          <button
            type="button"
            className="bag-offer"
            aria-pressed={checked !== null}
            title="カバンの物にチェックを付けて、まとめて置いたり手持ちへ出したりします"
            onClick={() => {
              setChecked(checked ? null : new Set());
              setSel(null);
            }}
          >
            {checked ? "選ぶのをやめる" : "選ぶ"}
          </button>
          <button
            type="button"
            className="bag-offer"
            title="足元の店が買い取る物を、カバンと手持ち (装備中は除く) から全部渡します。店の前のマスに立って押してください"
            onClick={() => {
              props.onOffer();
              setSel(null);
            }}
          >
            ここで売れる物を全部渡す
          </button>
        </div>
        <div className="bag-tabs" role="tablist">
          {TABS.map((t, i) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={tab === i}
              onClick={() => {
                setTab(i);
                setPage(0);
              }}
            >
              {t.label}
            </button>
          ))}
          <label className="bag-search">
            <Search size={14} />
            <input
              value={query}
              placeholder="名前で探す"
              // 入力欄のキーは App の Esc で閉じる処理に届かないので、ここで閉じる (#143)
              onKeyDown={(e) => {
                if (e.key === "Escape" && !e.nativeEvent.isComposing) props.onClose();
              }}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        <div className="bag-grid bag-store">
          {props.bag === null ? (
            <p className="bag-note">読み込み中...</p>
          ) : shown.length === 0 ? (
            <p className="bag-note">{props.bag.length ? "当てはまる物がありません" : "カバンは空です"}</p>
          ) : (
            shown.slice(at * PAGE, (at + 1) * PAGE).map(({ it, no }) =>
              checked ? (
                <Tile
                  key={no}
                  item={it}
                  selected={checked.has(no)}
                  checked={checked.has(no)}
                  onClick={() => {
                    const next = new Set(checked);
                    if (!next.delete(no)) next.add(no);
                    setChecked(next);
                    // 最後に押した物の名前と詳しい情報を、下の欄に出す
                    setSel({ where: "bag", i: no });
                  }}
                />
              ) : (
                <Tile key={no} item={it} selected={sel?.where === "bag" && sel.i === no} onClick={() => setSel({ where: "bag", i: no })} />
              ),
            )
          )}
        </div>
        {pages > 1 && (
          <div className="bag-pages">
            <button type="button" disabled={at === 0} onClick={() => setPage(at - 1)}>
              前へ
            </button>
            <span>
              {at + 1} / {pages}
            </span>
            <button type="button" disabled={at === pages - 1} onClick={() => setPage(at + 1)}>
              次へ
            </button>
          </div>
        )}
        {checked && (
          <div className="bag-detail" ref={detail}>
            {picked && (
              <>
                <div className="bag-name" data-line="name" key={picked.html} dangerouslySetInnerHTML={{ __html: picked.html }} />
                {details(picked).map((l) => (
                  <div key={l}>{l}</div>
                ))}
              </>
            )}
            <div>
              {checked.size} 個を選んでいます
              {checked.size > free ? ` (手持ちの空きは ${free} 個)` : ""}
            </div>
            {checked.size > 0 && <div className="bag-picked">{pickedNames(props.bag ?? [], checked)}</div>}
            <div className="bag-actions">
              <button type="button" onClick={() => setChecked(new Set(shown.map(({ no }) => no)))}>
                表示中を全部選ぶ ({shown.length})
              </button>
              <button type="button" disabled={!checked.size} onClick={() => setChecked(new Set())}>
                選択を解除
              </button>
              <button
                type="button"
                disabled={!checked.size}
                onClick={() => {
                  props.onDropMany(descending(checked));
                  setChecked(null);
                }}
              >
                選んだ物を置く
              </button>
              <button
                type="button"
                disabled={!checked.size || checked.size > free}
                title={checked.size > free ? "手持ちの空きが足りません" : undefined}
                onClick={() => {
                  props.onGetMany(descending(checked));
                  setChecked(null);
                }}
              >
                手持ちへ出す
              </button>
            </div>
          </div>
        )}
        {picked && sel && !checked && (
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
              <div className="bag-actions">
                <button
                  type="button"
                  onClick={() => {
                    props.onGet(sel.i);
                    setSel(null);
                  }}
                >
                  取り出す
                </button>
                {/* 手持ちを通さずに足元へ置く。店の前なら、置いた物を買い取る */}
                <button
                  type="button"
                  onClick={() => {
                    props.onDrop(sel.i, 1);
                    setSel(null);
                  }}
                >
                  置く
                </button>
                {same > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      props.onDrop(sel.i, same);
                      setSel(null);
                    }}
                  >
                    同じ物を全部置く ({same})
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {props.message && <p className="bag-note">{props.message}</p>}
      </div>
    </div>
  );
}
