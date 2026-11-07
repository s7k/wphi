// map 窓(Philly の MapForm)。アクティブなタブのマップとステータスを表示する。
// 状態は main 窓から MAP_STATE_EVENT で届く。
//
// 配置は MapForm.dfm に合わせた。マップ(等倍で中央)、右に方角とキャラ名の一覧(ImageMapSide)、
// 下にステータス(ImageStatus)、一番下に状態異常のステータスバー。
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { assetUrl } from "./asset";
import { drawMap, type ImageRefs } from "./drawMap";
import { KEY_EVENT, MOUSE_EVENT, type ForwardedKey, type ForwardedMouse } from "./keyInput";
import { mouseDir } from "./mouseDir.ts";
import { CHIP_SIZE, gridDim } from "./mapRender";
import { MAP_STATE_EVENT, type MapState, type StatusEvent } from "./protocol";
import { CondBadges, Compass, StatusPanel } from "./StatusPanel";
import { hideOnClose, useImages } from "./windowUtil";
import "./style.css";

/** Philly のキャラのアニメ周期(PersonalThread.h の ANIMATION_INTERVAL = 500ms) */
const ANIMATION_MS = 500;
/** 回転マップの時のタイトルの向き(MakeMap.cpp の DrawDirectionAnime) */
const DIRECTION_TITLE: Record<number, string> = { 0: "【北】", 2: "【東】", 4: "【南】", 6: "【西】" };

const stripTags = (s: string) => s.replace(/\/\*.*?\*\//g, "").trim();

function MapWindow() {
  const [state, setState] = useState<MapState | null>(null);
  const [frame, setFrame] = useState(0);
  const [, setLoaded] = useState(0);
  const image = useImages(() => setLoaded((n) => n + 1));
  const mapCanvas = useRef<HTMLCanvasElement>(null);
  // HP・MP の減った分を出す為の、1つ前の #status(Philly の OldStatus)
  const prevStatus = useRef<{ now?: StatusEvent; old?: StatusEvent }>({});

  useEffect(() => {
    hideOnClose();
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
    return () => {
      unlisten.then((f) => f());
      clearInterval(timer);
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

  // マップのマウス操作。左ボタンでその向きへ進み、右ボタンで hit(Philly の MapForm.cpp)
  const [cursor, setCursor] = useState("default");
  const mouseDown = useRef(false);
  const sendMouse = (m: ForwardedMouse) => emitTo("main", MOUSE_EVENT, m).catch(console.error);
  const dirAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // canvas は等倍で中央に描いているので、要素の中心がマップの中心
    const r = e.currentTarget.getBoundingClientRect();
    const size = dim * CHIP_SIZE;
    const x = e.clientX - (r.left + r.width / 2) + size / 2;
    const y = e.clientY - (r.top + r.height / 2) + size / 2;
    return mouseDir(x, y, size, size, northFix, e.shiftKey || e.ctrlKey);
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const d = dirAt(e);
    setCursor(d?.cursor ?? "default");
    if (mouseDown.current && d) sendMouse({ type: "move", keys: d.keys });
  };
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 2) {
      sendMouse({ type: "hit" });
      return;
    }
    const d = e.button === 0 ? dirAt(e) : null;
    if (!d) return;
    mouseDown.current = true;
    sendMouse({ type: "down", keys: d.keys });
  };
  const onMouseUp = () => {
    if (!mouseDown.current) return;
    mouseDown.current = false;
    sendMouse({ type: "up" });
  };
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

  // 名前の一覧は上の行から順に並べる(CharacterNameList.cpp の SetNameList)
  const names = (map?.chars ?? [])
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.y - b.c.y || a.i - b.i)
    .map(({ c }) => stripTags(c.name))
    .filter((n) => n);
  return (
    <div className="map-window">
      <div className="map-row">
        <canvas
          className="map-canvas"
          ref={mapCanvas}
          width={dim * CHIP_SIZE}
          height={dim * CHIP_SIZE}
          style={{ cursor }}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onContextMenu={(e) => e.preventDefault()}
        />
        <div className="map-side">
          <Compass dir={direction} northFix={northFix} />
          {/* リスト表示中は名前の代わりにリストを出す(Philly.ini の ListInMap=on)。選ぶのは main 窓かキー */}
          <ul className={state?.list ? "name-list list" : "name-list"}>
            {(state?.list ? state.list.map(stripTags) : names).map((n, i) => (
              <li key={i} title={n}>
                {n}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <StatusPanel
        session={state?.session ?? -1}
        now={prevStatus.current.now}
        old={prevStatus.current.old}
        cond={state?.cond}
      />
      <div className="map-status-bar">
        <CondBadges cond={state?.cond} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MapWindow />
  </StrictMode>,
);
