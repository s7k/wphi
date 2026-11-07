// map 窓(Philly の MapForm)。アクティブなタブのマップとステータスを表示する。
// 状態は main 窓から MAP_STATE_EVENT で届く。
//
// 配置は MapForm.dfm に合わせた。マップ(窓に合わせて拡大縮小)、右に方角とキャラ名の一覧(ImageMapSide)、
// 下にステータス(ImageStatus)、一番下に状態異常のステータスバー。
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { assetUrl, skinUrl } from "./asset";
import { drawMap, type ImageRefs } from "./drawMap";
import { KEY_EVENT, type ForwardedKey } from "./keyInput";
import { CHIP_SIZE, gridDim } from "./mapRender";
import { MAP_STATE_EVENT, type MapState, type StatusEvent } from "./protocol";
import { drawStatus, STATUS_HEIGHT } from "./statusPanel";
import "./style.css";

/** Philly のキャラのアニメ周期(PersonalThread.h の ANIMATION_INTERVAL = 500ms) */
const ANIMATION_MS = 500;
/** 方角の欄の一辺(MakeMap.h の CHARACTER_AREA_TOP) */
const DIRECTION_AREA = 53;
/** 回転マップの時のタイトルの向き(MakeMap.cpp の DrawDirectionAnime) */
const DIRECTION_TITLE: Record<number, string> = { 0: "【北】", 2: "【東】", 4: "【南】", 6: "【西】" };

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

const stripTags = (s: string) => s.replace(/\/\*.*?\*\//g, "").trim();

function MapWindow() {
  const [state, setState] = useState<MapState | null>(null);
  const [frame, setFrame] = useState(0);
  const [, setLoaded] = useState(0);
  const [width, setWidth] = useState(window.innerWidth);
  const image = useImages(() => setLoaded((n) => n + 1));
  const mapCanvas = useRef<HTMLCanvasElement>(null);
  const statusCanvas = useRef<HTMLCanvasElement>(null);
  // HP・MP の減った分を出す為の、1つ前の #status(Philly の OldStatus)
  const prevStatus = useRef<{ now?: StatusEvent; old?: StatusEvent }>({});

  useEffect(() => {
    const unlisten = listen<MapState>(MAP_STATE_EVENT, (e) => {
      const s = e.payload;
      const p = prevStatus.current;
      // イベントのたびに別のオブジェクトで届くので、中身で比べる。#status が届くたびに1つ前の値になる
      if (JSON.stringify(s.status) !== JSON.stringify(p.now)) prevStatus.current = { now: s.status, old: p.now ?? s.status };
      setState(s);
    });
    // 開いた直後の状態を main 窓に求める
    unlisten.then(() => emitTo("main", "phi-map-ready"));
    const timer = setInterval(() => setFrame((f) => f ^ 1), ANIMATION_MS);
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => {
      unlisten.then((f) => f());
      clearInterval(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // マップ窓で押したキーは main 窓へ送り、そこで操作にする(Philly も FormMap のキーを KeyDown に回す)
  useEffect(() => {
    const forward = (k: ForwardedKey) => emitTo("main", KEY_EVENT, k).catch(console.error);
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // Tab や Space でマップ窓の中が動かないようにする
      e.preventDefault();
      const { code, shiftKey, ctrlKey, altKey, metaKey, repeat } = e;
      forward({ type: e.type as "keydown" | "keyup", code, shiftKey, ctrlKey, altKey, metaKey, repeat });
    };
    const onBlur = () =>
      forward({ type: "blur", code: "", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false });
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const map = state?.map;
  const dim = map ? gridDim(map.size) : 7;
  const northFix = !map || (map.size === 7 && map.style !== "turn");
  const direction = northFix ? 0 : (map?.dir ?? 0);

  // タイトル(MakeMap.cpp の DrawDirectionAnime)
  const place = state?.area ? `${state.area} （${state.world ?? ""}）` : "マップ";
  const title = (northFix ? "" : (DIRECTION_TITLE[direction] ?? "")) + place;
  useEffect(() => {
    getCurrentWindow().setTitle(title).catch(console.error);
  }, [title]);

  useEffect(() => {
    const ctx = mapCanvas.current?.getContext("2d");
    if (!ctx || !map || !state) return;
    const imgs: ImageRefs = {
      chip: image(assetUrl("chip", { mapset: state.mapset })),
      items: image(assetUrl("items")),
      chara: image,
    };
    drawMap(ctx, { size: map.size, mapset: state.mapset, cells: map.cells, chars: map.chars }, imgs, frame);
  });

  useEffect(() => {
    const ctx = statusCanvas.current?.getContext("2d");
    if (!ctx) return;
    const imgs = {
      panel: image(skinUrl("HpMpPanel", "teal")) ?? undefined,
      status: image(skinUrl("Status", "teal")) ?? undefined,
      bar: image(skinUrl("HpMpBar", "none")) ?? undefined,
    };
    drawStatus(ctx, width, imgs, prevStatus.current.now, prevStatus.current.old, state?.cond);
  });

  // 名前の一覧は上の行から順に並べる(CharacterNameList.cpp の SetNameList)
  const names = (map?.chars ?? [])
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.y - b.c.y || a.i - b.i)
    .map(({ c }) => stripTags(c.name))
    .filter((n) => n);
  const directionImg = image(skinUrl("Direction", "white"));
  const cond = state?.cond;
  // ステータスバーの状態異常(classStatus::DrawCondition)。毒とパニックは HP・MP のバーの色で出す
  const condIcons = cond
    ? ([cond.palsy, cond.confuse, cond.berserk, cond.silence, cond.blind] as const)
        .map((on, i) => (on ? i : -1))
        .filter((i) => i >= 0)
    : [];

  return (
    <div className="map-window">
      <div className="map-row">
        <canvas className="map-canvas" ref={mapCanvas} width={dim * CHIP_SIZE} height={dim * CHIP_SIZE} />
        <div className="map-side">
          <div className={northFix ? "direction pressed" : "direction"} style={{ width: DIRECTION_AREA, height: DIRECTION_AREA }}>
            {directionImg && (
              <div
                className="direction-image"
                style={{ backgroundImage: `url("${directionImg.src}")`, backgroundPosition: `-${direction * 50}px 0` }}
              />
            )}
          </div>
          <ul className="name-list">
            {names.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      </div>
      <canvas
        className="status-canvas"
        ref={statusCanvas}
        width={width}
        height={STATUS_HEIGHT}
        title={state?.status?.exp !== undefined ? `Exp:${state.status.exp}` : undefined}
      />
      <div className="map-status-bar">
        {condIcons.map((i) => (
          <span
            key={i}
            className="cond-icon"
            style={{ backgroundImage: `url("${skinUrl("StatusBarImage", "none")}")`, backgroundPosition: `-${i * 18}px 0` }}
          />
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MapWindow />
  </StrictMode>,
);
