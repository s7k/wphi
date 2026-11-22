import { useEffect, useRef, useState } from "react";
import { MapView } from "./map";

export const MAP_PANE_KEY = "wphi:mapPaneWidth";
/** 地図の欄の下のステータス(.status-panel 50px と .map-status-bar 22px と線)と、右の方角と名前の欄(.map-side) */
export const MAP_PANE_BELOW = 74;
export const MAP_PANE_SIDE = 153;

/** ログの左に置く地図(settings.singleWindow)。境目をドラッグして幅を変え、この窓の localStorage に覚える。
 * 縦長の窓では、CSS で地図を上に積む */
export function MapPane() {
  const [width, setWidth] = useState<number | null>(() => {
    try {
      return Number(localStorage.getItem(MAP_PANE_KEY)) || null;
    } catch {
      return null;
    }
  });
  const pane = useRef<HTMLDivElement>(null);
  // 幅を決めていない間は、地図の欄が正方形になる幅にする。欄の高さは、ログの欄の高さからステータスの分を引いた物
  const [auto, setAuto] = useState(0);
  useEffect(() => {
    const body = pane.current?.parentElement;
    if (!body) return;
    const ro = new ResizeObserver(() =>
      setAuto(Math.round(Math.min(body.clientHeight - MAP_PANE_BELOW + MAP_PANE_SIDE, body.clientWidth * 0.6))),
    );
    ro.observe(body);
    return () => ro.disconnect();
  }, []);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const left = pane.current?.getBoundingClientRect().left ?? 0;
    const bar = e.currentTarget;
    bar.setPointerCapture(e.pointerId);
    let w = width ?? auto;
    const move = (m: PointerEvent) => setWidth((w = Math.max(200, Math.round(m.clientX - left))));
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      try {
        if (w) localStorage.setItem(MAP_PANE_KEY, String(w));
      } catch {
        // 覚えられなくても、今の幅のまま使う
      }
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  };
  return (
    <>
      <div className="map-pane" ref={pane} style={{ width: width ?? (auto || undefined) }}>
        <MapView embedded />
      </div>
      <div className="map-pane-splitter" onPointerDown={onPointerDown} title="ドラッグで地図の幅を変える" />
    </>
  );
}
