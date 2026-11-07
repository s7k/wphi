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
import { compose, ringFor, loadTiles, storageKey, type Tiles } from "./automap.ts";
import { drawMap, type ImageRefs } from "./drawMap";
import { KEY_EVENT, MOUSE_EVENT, type ForwardedKey, type ForwardedMouse } from "./keyInput";
import { mouseDir } from "./mouseDir.ts";
import { CHIP_SIZE, MAP_TOP, gridDim } from "./mapRender";
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
  // マップの欄。外周の幅はこの枠の大きさで決める(canvas の大きさは外周の幅で変わるので測らない)
  const mapArea = useRef<HTMLDivElement>(null);
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

  // 拡張マップ。main 窓が localStorage に貯めた地形を、通常マップの外周に暗くして敷く。
  // 拡大縮小はしないので、外周の幅はマップの欄に等倍で収まる分だけ(最大 AUTOMAP_RING)
  const world = state?.world;
  const [tiles, setTiles] = useState<Tiles>({});
  useEffect(() => {
    if (!world) return;
    setTiles(loadTiles(world));
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey(world)) setTiles(loadTiles(world));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [world]);
  const [area, setArea] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = mapArea.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ring = ringFor(area.w, area.h - MAP_TOP, CHIP_SIZE);
  const automap = map ? compose(map, tiles, ring) : null;
  const dim = automap?.dim ?? (map ? gridDim(map.size) : 7);
  const northFix = !map || (map.size === 7 && map.style !== "turn");

  // マップのマウス操作。左ボタンでその向きへ進み、右ボタンで hit(Philly の MapForm.cpp)
  const [cursor, setCursor] = useState("default");
  const mouseDown = useRef(false);
  const sendMouse = (m: ForwardedMouse) => emitTo("main", MOUSE_EVENT, m).catch(console.error);
  const dirAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // canvas は等倍。マップは上の余白(MAP_TOP)の下から描いている
    const r = e.currentTarget.getBoundingClientRect();
    const size = dim * CHIP_SIZE;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top - MAP_TOP;
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
    // 上の余白を黒で塗り、マップはその下から描く(一番上の行のはみ出しは余白に出る)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ctx.canvas.width, MAP_TOP);
    ctx.translate(0, MAP_TOP);
    const imgs: ImageRefs = {
      chip: image(assetUrl("chip", { mapset: state.mapset })),
      items: image(assetUrl("items")),
      chara: image,
    };
    if (!automap) {
      drawMap(ctx, { size: map.size, mapset: state.mapset, cells: map.cells, chars: map.chars }, imgs, frame);
      return;
    }
    drawMap(
      ctx,
      { size: map.size, dim: automap.dim, mapset: state.mapset, cells: automap.cells, chars: automap.chars },
      imgs,
      frame,
    );
    // 記録地図から描いたマスを暗くし、今見えているマスと見分ける
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    automap.recalled.forEach((on, i) => {
      if (on) ctx.fillRect((i % automap.dim) * CHIP_SIZE, Math.floor(i / automap.dim) * CHIP_SIZE, CHIP_SIZE, CHIP_SIZE);
    });
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
        <div className="map-area" ref={mapArea}>
          <canvas
            ref={mapCanvas}
            width={dim * CHIP_SIZE}
            height={dim * CHIP_SIZE + MAP_TOP}
            // 中央に置く。位置を整数にして、半ピクセルずれて画像がにじまないようにする
            style={{
              cursor,
              left: Math.floor((area.w - dim * CHIP_SIZE) / 2),
              top: Math.floor((area.h - dim * CHIP_SIZE - MAP_TOP) / 2),
            }}
            onMouseMove={onMouseMove}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
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
