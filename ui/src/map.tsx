// map 窓(Philly の MapForm)。アクティブなタブのマップとステータスを表示する。
// 状態は main 窓から MAP_STATE_EVENT で届く。
import { emitTo, listen } from "@tauri-apps/api/event";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { assetUrl } from "./asset";
import { drawMap, type ImageRefs } from "./drawMap";
import { CHIP_SIZE, gridDim } from "./mapRender";
import { MAP_STATE_EVENT, type CondEvent, type MapState, type StatusEvent } from "./protocol";
import "./style.css";

/** Philly のキャラのアニメ周期(PersonalThread.h の ANIMATION_INTERVAL = 500ms) */
const ANIMATION_MS = 500;

/** URL → 画像。読み込みが終わったら onLoad を呼ぶ */
function useImages(onLoad: () => void) {
  const cache = useRef(new Map<string, HTMLImageElement | null>());
  return (url: string): HTMLImageElement | null | undefined => {
    const c = cache.current;
    if (c.has(url)) {
      const img = c.get(url)!;
      return img && img.complete ? img : img === null ? null : undefined;
    }
    const img = new Image();
    img.onload = onLoad;
    img.onerror = () => c.set(url, null);
    img.src = url;
    c.set(url, img);
    return undefined;
  };
}

function MapWindow() {
  const [state, setState] = useState<MapState | null>(null);
  const [frame, setFrame] = useState(0);
  const [, setLoaded] = useState(0);
  const image = useImages(() => setLoaded((n) => n + 1));
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const unlisten = listen<MapState>(MAP_STATE_EVENT, (e) => setState(e.payload));
    // 開いた直後の状態を main 窓に求める
    unlisten.then(() => emitTo("main", "phi-map-ready"));
    const timer = setInterval(() => setFrame((f) => f ^ 1), ANIMATION_MS);
    return () => {
      unlisten.then((f) => f());
      clearInterval(timer);
    };
  }, []);

  const map = state?.map;
  const dim = map ? gridDim(map.size) : 7;

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !map || !state) return;
    const imgs: ImageRefs = {
      chip: image(assetUrl("chip", { mapset: state.mapset })),
      items: image(assetUrl("items")),
      chara: image,
    };
    drawMap(ctx, { size: map.size, mapset: state.mapset, cells: map.cells, chars: map.chars }, imgs, frame);
  });

  return (
    <div className="map-window">
      <canvas ref={canvas} width={dim * CHIP_SIZE} height={dim * CHIP_SIZE} />
      <StatusPanel status={state?.status} cond={state?.cond} />
    </div>
  );
}

const COND_LABELS: [keyof Omit<CondEvent, "type">, string][] = [
  ["poison", "毒"],
  ["palsy", "麻痺"],
  ["panic", "パニック"],
  ["confuse", "混乱"],
  ["berserk", "バーサーク"],
  ["silence", "沈黙"],
  ["blind", "盲目"],
];

// ponytail: 文字だけのステータス。スキンの HpMpPanel.bmp・Status.bmp を使う表示は P2 の後半で作る
function StatusPanel(props: { status?: StatusEvent; cond?: CondEvent }) {
  const s = props.status;
  const conds = props.cond ? COND_LABELS.filter(([k]) => props.cond![k]).map(([, l]) => l) : [];
  return (
    <div className="status-panel">
      <div>{s?.name ?? "-"}</div>
      <div>
        HP {s?.hp ?? "-"}/{s?.maxHp ?? "-"} MP {s?.mp ?? "-"}/{s?.maxMp ?? "-"}
      </div>
      <div>
        EXP {s?.exp ?? "-"} GP {s?.gp ?? "-"}
      </div>
      <div>{conds.join(" ")}</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MapWindow />
  </StrictMode>,
);
