// 店の窓 (#v6 B。#187) と NPC との会話の窓 (#v6 K。#188)。どちらも看板の札と同じ暗い札で、地図の上に出す
import { useState } from "react";
import { X } from "lucide-react";
import { details, Tile } from "./BagPanel";
import { stripTags } from "./mapPop.ts";
import type { FloorItem, ItemInfo, Quest, TalkWord, TradeSide } from "./protocol";

/** 乗ったマスの売り場の品と値段。買うと pay 値段 を送る (品は売り場のスイッチが出す) */
export function ShopPanel(props: { items: FloorItem[]; gp?: number; onBuy: (it: FloorItem) => void; onClose: () => void }) {
  return (
    <div className="sign-card shop-card" role="dialog" aria-label="店">
      <div className="sign-head">
        <span>店{props.gp !== undefined && <small> 所持金 {props.gp} gp</small>}</span>
        <button type="button" title="閉じる(Esc)" onClick={props.onClose}>
          <X />
        </button>
      </div>
      <div className="shop-list">
        {props.items.map((f) => {
          const short = props.gp !== undefined && f.gp !== undefined && f.gp > props.gp;
          return (
            <div key={f.no} className="shop-row" title={f.item ? [f.item.name, ...details(f.item)].join("\n") : undefined}>
              <Tile item={f.item ?? null} selected={false} />
              <span className="shop-name">{f.item?.name}</span>
              <span className={short ? "shop-price short" : "shop-price"}>{f.gp} gp</span>
              <button type="button" disabled={short} title={short ? "所持金が足りません" : undefined} onClick={() => props.onBuy(f)}>
                買う
              </button>
            </div>
          );
        })}
      </div>
      <p className="shop-note">買うと品が売り場に出ます。同じ値段の品があると、両方が出る事があります。</p>
    </div>
  );
}

/** NPC に言える言葉。押すとその言葉を話す (メニューの選択はそのまま、NPC の言葉は ? を付ける) */
export function TalkPanel(props: { words: TalkWord[]; onSay: (w: TalkWord) => void; onClose: () => void }) {
  return (
    <div className="sign-card talk-card" role="dialog" aria-label="会話">
      <div className="sign-head">
        <span>話す</span>
        <button type="button" title="閉じる(Esc)" onClick={props.onClose}>
          <X />
        </button>
      </div>
      <div className="talk-words">
        {props.words.map((w) => (
          <button key={`${w.menu}${w.word}`} type="button" className={w.menu ? "talk-word menu" : "talk-word"} onClick={() => props.onSay(w)}>
            {w.word}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 今出ている依頼と、その今の段階の目的 (#v6 Q。#193)。モダンの左上の HUD の下に出す */
export function QuestHud(props: { quests: Quest[] }) {
  if (!props.quests.length) return null;
  return (
    <div className="quest-hud" aria-label="依頼">
      {props.quests.map((q) => (
        <div key={q.no} className="quest-row">
          <span className="quest-title">{stripTags(q.title)}</span>
          <span className="quest-text">{stripTags(q.text)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 取引の窓 (#v6 Y。#192)。左が自分の出す物、右が相手の出す物。出す物を変えると両方の承諾が外れる。
 * 両方が承諾すると入れ替わる (DM が #v6 Y done を送って閉じる)
 */
export function TradePanel(props: {
  name: string;
  me: TradeSide;
  you: TradeSide;
  hand: (ItemInfo | null)[];
  bag: ItemInfo[] | null;
  onPut: (slot: number) => void;
  onBag: (no: number) => void;
  onGp: (gp: number) => void;
  onOk: () => void;
  onCancel: () => void;
}) {
  const [gp, setGp] = useState(String(props.me.gp || ""));
  const offered = (from: string) => props.me.items.some((i) => i.from === from);
  const side = (title: string, s: TradeSide) => (
    <div className="trade-side">
      <div className="trade-head">
        {title}
        {s.ok && <span className="trade-ok">承諾</span>}
      </div>
      <div className="trade-items">
        {s.items.map((i) => (
          <Tile key={i.from} item={i.item} selected={false} />
        ))}
        {!s.items.length && <span className="trade-none">物は無し</span>}
      </div>
      <div>{s.gp} gp</div>
    </div>
  );
  return (
    <div className="sign-card trade-card" role="dialog" aria-label="取引">
      <div className="sign-head">
        <span>{props.name} と取引</span>
        <button type="button" title="やめる(Esc)" onClick={props.onCancel}>
          <X />
        </button>
      </div>
      <div className="trade-body">
        {side("自分が出す物", props.me)}
        {side(`${props.name} が出す物`, props.you)}
      </div>
      <div className="trade-pick">
        <div className="trade-head">手持ちから出す (もう一度押すと引っ込める)</div>
        <div className="trade-items">
          {props.hand.map((it, i) =>
            it && it.eq === "-" ? (
              <Tile key={i} item={it} selected={offered(`put ${i + 1}`)} onClick={() => props.onPut(i + 1)} />
            ) : null,
          )}
        </div>
        {props.bag && props.bag.length > 0 && (
          <select value="" onChange={(e) => e.target.value && props.onBag(Number(e.target.value))}>
            <option value="">カバンから出す...</option>
            {props.bag.map((it, i) => (
              <option key={i} value={i + 1}>
                {offered(`bag ${i + 1}`) ? "✓ " : ""}
                {it.name}
              </option>
            ))}
          </select>
        )}
        <label>
          お金{" "}
          <input type="number" min={0} max={9999} value={gp} onChange={(e) => setGp(e.target.value)} />
          <button type="button" onClick={() => props.onGp(Math.max(0, Math.min(9999, Math.round(Number(gp) || 0))))}>
            決める
          </button>
        </label>
      </div>
      <div className="trade-buttons">
        <button type="button" disabled={props.me.ok} onClick={props.onOk}>
          承諾する
        </button>
        <button type="button" onClick={props.onCancel}>
          やめる
        </button>
      </div>
      <p className="shop-note">両方が承諾すると入れ替わります。どちらかが動くか、出す物を変えると承諾は外れます。</p>
    </div>
  );
}
