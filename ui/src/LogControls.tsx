import { useRef, useState } from "react";


export const LOG_HEIGHT_KEY = "wphi:modernLogHeight";
/** モダンのログの高さ(窓の高さの %)。小・中・大 */
export const LOG_HEIGHTS: [string, number][] = [
  ["小", 20],
  ["中", 42],
  ["大", 65],
];

export const LOG_WIDTH_KEY = "wphi:modernLogWidth";
export const LOG_MAX_KEY = "wphi:modernLogMax";
/** ログの横幅の下限 (px)。これより狭いと 1 行に数文字しか入らない */
export const LOG_MIN_WIDTH = 280;

/** この窓の localStorage に覚える数。読めないか valid に合わなければ既定の値 */
export function useStored(key: string, initial: number, valid: (n: number) => boolean = Number.isFinite): [number, (v: number) => void] {
  const [v, setV] = useState(() => {
    try {
      const n = Number(localStorage.getItem(key) ?? initial);
      return valid(n) ? n : initial;
    } catch {
      return initial;
    }
  });
  const set = (n: number) => {
    setV(n);
    try {
      localStorage.setItem(key, String(n));
    } catch {
      // 覚えられなくても、今の値のまま使う
    }
  };
  return [v, set];
}

/** モダンのログの右上の、高さを選ぶボタンと、窓いっぱいに広げるボタン */
export function LogHeight(props: { value: number; onChange: (v: number) => void; max: boolean; onMax: () => void }) {
  return (
    <div className="log-height" role="group" aria-label="ログの高さ">
      {LOG_HEIGHTS.map(([label, v]) => (
        <button key={v} type="button" aria-pressed={!props.max && props.value === v} disabled={props.max} onClick={() => props.onChange(v)}>
          {label}
        </button>
      ))}
      <button type="button" aria-pressed={props.max} title={props.max ? "ログを元の大きさに戻す" : "ログを窓いっぱいに広げる"} onClick={props.onMax}>
        全
      </button>
    </div>
  );
}

/** モダンのログの右端。ドラッグで横幅を変える。ダブルクリックで既定の幅に戻す */
export function LogWidthHandle(props: { onChange: (px: number) => void }) {
  const drag = useRef<{ left: number } | null>(null);
  return (
    <div
      className="log-width-handle"
      title="ドラッグで横幅を変える(ダブルクリックで元に戻す)"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const area = e.currentTarget.parentElement!.getBoundingClientRect();
        drag.current = { left: area.left };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const right = window.innerWidth - 16;
        props.onChange(Math.round(Math.max(LOG_MIN_WIDTH, Math.min(right, e.clientX) - drag.current.left)));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => props.onChange(0)}
    />
  );
}
