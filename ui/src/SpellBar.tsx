// 魔法の列。覚えている呪文をアイコンで並べ、押すか Alt+数字で唱える (ui/src/spells.ts)。
// アイコンは効果 (EF_*) ごとのドット絵、背景の色は属性 (持ち物のタイルと同じ)。
// ドラッグか Shift+← / → で並べ替える。HTML5 のドラッグ＆ドロップは、Windows の Tauri が窓へのファイルのドロップを
// 受ける間は効かないので、ポインタの操作で作る
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ELEMENT_COLOR, ItemIcon, Pixels } from "./BagPanel";

/** 自動攻撃のボタンの絵。itemIcons.png の双剣 (武器の種類の 9 番) */
const AUTO_ATTACK_ICON = 9;
import { spellPixels } from "./pixelIcons.ts";
import type { Skill, Spell } from "./protocol";
import { SKILL_KEYS, skillLeft, type SkillTimers } from "./skills.ts";
import { Crosshair, Flame, Swords, Zap } from "lucide-react";

/** 技のボタンの絵。強い順に並べた位置で決める (技ごとの絵は無い) */
const SKILL_ICONS = [Flame, Zap, Swords, Crosshair];

/**
 * 技のボタン。待ちの間はグレーを重ね、12 時から時計回りに明るさを戻し、残りの秒数を出す。明けた時に縁を一度光らせる。
 * 扇形は毎フレーム CSS の変数 --p (残りの割合) を書き換えるだけで、React の描き直しはしない
 */
function SkillTile(props: { skill: Skill; slot: number; icon: number; timers?: SkillTimers; onUse: () => void }) {
  const el = useRef<HTMLButtonElement>(null);
  const sec = useRef<HTMLSpanElement>(null);
  const { timers, skill } = props;
  useEffect(() => {
    const b = el.current;
    if (!b) return;
    let raf = 0;
    let was = false;
    const tick = () => {
      // その技の待ちと共通の待ちの長い方を、それぞれの長さに対する割合で出す
      const { left, total } = skillLeft(timers, skill, performance.now());
      b.style.setProperty("--p", total > 0 ? (left / total).toFixed(4) : "0");
      b.classList.toggle("cooling", left > 0);
      if (sec.current) sec.current.textContent = left > 0 ? String(Math.ceil(left / 1000)) : "";
      if (was && left === 0) {
        b.classList.remove("ready-flash");
        void b.offsetWidth;
        b.classList.add("ready-flash");
      }
      was = left > 0;
      if (left > 0) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [timers, skill]);
  const Icon = SKILL_ICONS[props.icon % SKILL_ICONS.length];
  const s = props.skill;
  return (
    <button
      ref={el}
      type="button"
      className="spell-tile skill-tile"
      aria-label={`${s.name}${props.slot <= SKILL_KEYS ? ` (Shift+${props.slot})` : ""} ダメージ +${s.bonus}% 待ち ${s.cd / 10} 秒`}
      onClick={props.onUse}
    >
      <Icon aria-hidden="true" />
      <span className="skill-cd" aria-hidden="true" />
      <span className="skill-sec" ref={sec} aria-hidden="true" />
      {props.slot <= SKILL_KEYS && <span className="spell-key">⇧{props.slot}</span>}
      <span className="spell-name">
        {s.name} +{s.bonus}% (待ち {s.cd / 10} 秒)
      </span>
    </button>
  );
}

/** これだけ動かしたらドラッグとみなす (px)。押しただけでは唱える */
const DRAG_PX = 6;

export function SpellBar(props: {
  spells: Spell[];
  waiting: boolean;
  onCast: (spell: Spell) => void;
  /** 列の from 番目を to 番目へ動かす */
  onMove: (from: number, to: number) => void;
  /** 自動攻撃のボタン (列の左端。G と同じ。#183)。入っている間は赤くする */
  autoAttack?: boolean;
  onAutoAttack?: () => void;
  /** 自動攻撃の隣の、カルマの低い NPC を対象にしないかのボタン (設定の autoSkipLowKarma)。入っている間は青くする */
  skipLowKarma?: boolean;
  onSkipLowKarma?: () => void;
  /** 武器の技のボタン (ui/src/skills.ts。左から Shift+1〜4)。待ちはキャラに 1 つで、全ボタンに同じ扇形を出す */
  skills?: Skill[];
  skillTimers?: SkillTimers;
  onSkill?: (skill: Skill) => void;
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

  if (!props.spells.length && !props.onAutoAttack && !props.onSkipLowKarma && !props.skills?.length) return null;

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
    <div className="spell-bar" role="toolbar" aria-label="技と魔法 (魔法はドラッグか Shift+← → で並べ替え)">
      {/* 上の段に自動攻撃と技、下の段に魔法 */}
      <div className="spell-row attack-row">
        {props.onAutoAttack && (
          <button
            type="button"
            className={props.autoAttack ? "spell-tile auto-attack on" : "spell-tile auto-attack"}
            aria-pressed={!!props.autoAttack}
            aria-label={props.autoAttack ? "自動攻撃を止める (G)" : "近い敵を対象にして自動攻撃を始める (G)"}
            onClick={props.onAutoAttack}
          >
            <ItemIcon index={AUTO_ATTACK_ICON} size={32} />
            <span className="spell-key">G</span>
            <span className="spell-name">{props.autoAttack ? "自動攻撃を止める" : "自動攻撃"}</span>
          </button>
        )}
        {props.onSkipLowKarma && (
          <button
            type="button"
            className={props.skipLowKarma ? "spell-tile skip-low on" : "spell-tile skip-low"}
            aria-pressed={!!props.skipLowKarma}
            aria-label={
              props.skipLowKarma ? "カルマの低い NPC (町の人など) を対象にしない。押すと対象にする" : "カルマの低い NPC も対象にする。押すと対象にしない"
            }
            onClick={props.onSkipLowKarma}
          >
            <span className="skip-low-mark" aria-hidden="true">
              {props.skipLowKarma ? "町人\n除く" : "町人\n含む"}
            </span>
            <span className="spell-name">{props.skipLowKarma ? "カルマの低い NPC を対象にしない" : "カルマの低い NPC も対象にする"}</span>
          </button>
        )}
        {props.skills?.length ? (
          <div className="skill-group" role="group" aria-label="技">
            {props.skills.map((sk, i) => (
              <SkillTile
                key={sk.no}
                skill={sk}
                slot={i + 1}
                icon={i}
                timers={props.skillTimers}
                onUse={() => props.onSkill?.(sk)}
              />
            ))}
          </div>
        ) : null}
      </div>
      <div className="spell-row magic-row">
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
              {i < 8 && <span className="spell-key">Alt+{i + 1}</span>}
              {/* カーソルを当てるかキーで選ぶと、すぐ上に呪文の名前を出す */}
              <span className="spell-name">{s.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
