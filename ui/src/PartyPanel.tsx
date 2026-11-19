// 仲間の一覧の窓(#v6 P。phi_dm の docs/dev/protocol-v6.md の「仲間の一覧」)。Party eye と同じ情報を、届くたびに描き直す
import { X } from "lucide-react";
import type { PartyMember } from "./protocol";

const COND: [keyof PartyMember["cond"], string, string][] = [
  ["poison", "毒", "#a0e060"],
  ["palsy", "痺", "#ffff00"],
  ["panic", "恐", "#ffa040"],
  ["confuse", "乱", "#ff00ff"],
  ["berserk", "狂", "#ff0000"],
  ["silence", "黙", "#00ffff"],
  ["blind", "盲", "#00ff00"],
];

/** 自分から見た位置(東3 南1)。同じマスなら「同じ所」、階が違えば「別の階」 */
export function partyPos(m: PartyMember): string {
  if (m.dx === undefined || m.dy === undefined) return "別の階";
  const ew = m.dx > 0 ? `東${m.dx}` : m.dx < 0 ? `西${-m.dx}` : "";
  const ns = m.dy > 0 ? `南${m.dy}` : m.dy < 0 ? `北${-m.dy}` : "";
  return [ew, ns].filter(Boolean).join(" ") || "同じ所";
}

function Bar(props: { now: number; max: number; color: string; label: string }) {
  const pct = props.max > 0 ? Math.max(0, Math.min(100, (props.now / props.max) * 100)) : 0;
  return (
    <div className="party-bar" title={`${props.label} ${props.now}/${props.max}`}>
      <div style={{ width: `${pct}%`, background: props.color }} />
      <span>
        {props.label} {props.now}/{props.max}
      </span>
    </div>
  );
}

export function PartyPanel(props: { members: PartyMember[]; onBye: () => void; onClose: () => void }) {
  return (
    <div className="bag-panel party-panel" role="dialog" aria-label="パーティ">
      <div className="sign-head">
        <span>パーティ</span>
        <button type="button" title="閉じる(Esc)" onClick={props.onClose}>
          <X />
        </button>
      </div>
      <div className="bag-body">
        {props.members.length === 0 && <div>パーティに入っていません。</div>}
        {props.members.map((m, i) => (
          <div key={m.no} className="party-row">
            <div className="party-name">
              <span dangerouslySetInnerHTML={{ __html: m.html }} />
              {i === 0 && <span className="party-self">(自分)</span>}
              {COND.filter(([k]) => m.cond[k]).map(([k, label, color]) => (
                <span key={k} className="cond-badge" style={{ background: color }}>
                  {label}
                </span>
              ))}
            </div>
            <div className="party-where">
              {m.area} {i > 0 && partyPos(m)} 放置 {Math.floor(m.idle / 60)}'{String(m.idle % 60).padStart(2, "0")}
              {m.lag !== undefined && ` 遅延 ${(m.lag / 10).toFixed(1)}`}
            </div>
            <Bar now={m.hp} max={m.mhp} color="#d04040" label="HP" />
            <Bar now={m.mp} max={m.mmp} color="#4070e0" label="MP" />
          </div>
        ))}
        {props.members.length > 0 && (
          <button type="button" className="party-bye" onClick={props.onBye}>
            脱退(bye)
          </button>
        )}
      </div>
    </div>
  );
}

/** 閉じている間に出す小さな一覧(自分を除く仲間の名前、HP と MP の細いバー、状態異常)。押すと窓を開く */
export function PartyHud(props: { members: PartyMember[]; besidePriv: boolean; onOpen: () => void }) {
  return (
    <button type="button" className={props.besidePriv ? "party-hud beside-priv" : "party-hud"} title="パーティ(押すと開く)" onClick={props.onOpen}>
      {props.members.slice(1).map((m) => (
        <div key={m.no} className="party-hud-row">
          <div className="party-name">
            <span dangerouslySetInnerHTML={{ __html: m.html }} />
            {COND.filter(([k]) => m.cond[k]).map(([k, label, color]) => (
              <span key={k} className="cond-badge" style={{ background: color }}>
                {label}
              </span>
            ))}
          </div>
          <Thin now={m.hp} max={m.mhp} color="#d04040" />
          <Thin now={m.mp} max={m.mmp} color="#4070e0" />
        </div>
      ))}
    </button>
  );
}

function Thin(props: { now: number; max: number; color: string }) {
  const pct = props.max > 0 ? Math.max(0, Math.min(100, (props.now / props.max) * 100)) : 0;
  return (
    <div className="party-thin">
      <div style={{ width: `${pct}%`, background: props.color }} />
    </div>
  );
}
