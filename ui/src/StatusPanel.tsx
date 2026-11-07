// マップ窓の下のステータス表示。配置と色は Philly の classStatus(CharacterCommon.cpp)と
// スキンの HpMpPanel.bmp・HpMpBar.bmp・Status.bmp に合わせ、文字がにじまないよう HTML で描く。
// Status.bmp の teal の地は古く見えるので使わず、文字の色で見分ける。
import { sendLine } from "./keyInput";
import type { CondEvent, StatusEvent } from "./protocol";

/** バーの割合(0〜100) */
const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);

/**
 * HP か MP のバー。減った時は1つ前の #status の値までを赤で出す(Philly の DrawStatusContents)。
 * 毒(HP)とパニック(MP)の時はバーを紫にする。
 */
function Bar(props: { kind: "hp" | "mp"; now: number; old: number; max: number; bad: boolean }) {
  const { now, old, max } = props;
  const filled = pct(now, max);
  const lost = old > now ? pct(Math.min(old, max), max) - filled : 0;
  return (
    <div className="bar">
      <div className={`bar-fill ${props.bad ? "bad" : props.kind}`} style={{ width: `${filled}%` }} />
      <div className="bar-lost" style={{ width: `${lost}%` }} />
      <div className="bar-text">
        {now}/{max}
      </div>
    </div>
  );
}

export function StatusPanel(props: {
  session: number;
  now?: StatusEvent;
  old?: StatusEvent;
  cond?: CondEvent;
}) {
  const s = props.now;
  const hp = s?.hp ?? 0;
  const mp = s?.mp ?? 0;
  const value = (v: number | undefined) => <span className="status-value">{v ?? ""}</span>;
  const send = (text: string) => props.session >= 0 && sendLine(props.session, text);
  return (
    <div className="status-panel" title={s?.exp !== undefined ? `Exp:${s.exp}` : undefined}>
      <div className="hpmp-labels">
        <span className="label-hp">Hp</span>
        <span className="label-mp">Mp</span>
      </div>
      <div className="bars">
        {s?.maxHp !== undefined && (
          <>
            <Bar kind="hp" now={hp} old={props.old?.hp ?? hp} max={s.maxHp} bad={!!props.cond?.poison} />
            <Bar kind="mp" now={mp} old={props.old?.mp ?? mp} max={s.maxMp ?? 0} bad={!!props.cond?.panic} />
          </>
        )}
      </div>
      <div className="fwmc">
        <span className="label-f">F</span>
        {value(s?.f)}
        <span className="label-w">W</span>
        {value(s?.w)}
        <span className="label-m">M</span>
        {value(s?.m)}
        <span className="label-c">C</span>
        {value(s?.c)}
        <button className="status-button" onClick={() => send("check\nlook")}>
          CHK
        </button>
        <button className="status-button" onClick={() => send("skills")}>
          SKL
        </button>
        <span className="label-gp">Gp</span>
        {value(s?.gp)}
      </div>
    </div>
  );
}

/** ステータスバーの状態異常(classStatus::DrawCondition と StatusBarImage.bmp)。毒とパニックはバーの色で出す */
const COND_BADGES: [keyof Omit<CondEvent, "type">, string, string][] = [
  ["palsy", "痺", "#ffff00"],
  ["confuse", "乱", "#ff00ff"],
  ["berserk", "狂", "#ff0000"],
  ["silence", "黙", "#00ffff"],
  ["blind", "盲", "#00ff00"],
];

export function CondBadges(props: { cond?: CondEvent }) {
  const c = props.cond;
  return (
    <>
      {COND_BADGES.filter(([k]) => c?.[k]).map(([k, label, color]) => (
        <span key={k} className="cond-badge" style={{ background: color }}>
          {label}
        </span>
      ))}
    </>
  );
}

/**
 * 方角(Direction.bmp の代わり)。dir は N=0 から時計回りに45度刻み。
 * 北固定の時は Philly と同じく押し込んだ見た目にする。
 */
export function Compass(props: { dir: number; northFix: boolean }) {
  const angle = props.dir * 45;
  return (
    <svg className={props.northFix ? "compass pressed" : "compass"} viewBox="0 0 50 50" width="50" height="50">
      <circle cx="25" cy="25" r="22" fill="#f4f4f4" stroke="#b08a2a" strokeWidth="2" />
      {(["N", "E", "S", "W"] as const).map((l, i) => {
        const a = (i * 90 * Math.PI) / 180;
        return (
          <text key={l} x={25 + Math.sin(a) * 16} y={25 - Math.cos(a) * 16} className={l === "N" ? "compass-n" : ""}>
            {l}
          </text>
        );
      })}
      <g transform={`rotate(${angle} 25 25)`}>
        <polygon points="25,9 30,25 25,22 20,25" fill="#3a8a1a" />
        <polygon points="25,41 30,25 25,28 20,25" fill="#9a9a9a" />
      </g>
      <circle cx="25" cy="25" r="3" fill="#b08a2a" />
    </svg>
  );
}
