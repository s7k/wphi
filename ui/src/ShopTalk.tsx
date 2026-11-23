// 店の窓 (#v6 B。#187) と NPC との会話の窓 (#v6 K。#188)。どちらも看板の札と同じ暗い札で、地図の上に出す
import { X } from "lucide-react";
import { details, Tile } from "./BagPanel";
import type { FloorItem, TalkWord } from "./protocol";

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
