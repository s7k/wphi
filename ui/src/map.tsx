// map 窓(Philly の MapForm)。アクティブなタブのマップとステータスを表示する。
// 状態は main 窓から MAP_STATE_EVENT で届く。
//
// 配置は MapForm.dfm に合わせた。マップ(等倍で中央)、右に方角とキャラ名の一覧(ImageMapSide)、
// 下にステータス(ImageStatus)、一番下に状態異常のステータスバー。
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { assetUrl } from "./asset";
import { AUTOMAP_EVENT, compose, predictedMap, ringFor, loadTiles, type AutomapDiff, type Tiles } from "./automap.ts";
import { drawMap, type ImageRefs } from "./drawMap";
import { trace } from "./trace.ts";
import { KEY_EVENT, MOUSE_EVENT, sendLine, type ForwardedKey, type ForwardedMouse } from "./keyInput";
import { mouseDir, northFixTurn } from "./mouseDir.ts";
import { CHIP_SIZE, MAP_TOP, SLIDE_MS, gridDim, slideStep } from "./mapRender";
import { EXPERIMENT_EVENT, type Settings } from "./settings";
import { MAP_LIST_EVENT, MAP_STATE_EVENT, type MapListAction, type MapState, type StatusEvent } from "./protocol";
import { CondBadges, Compass, StatusPanel } from "./StatusPanel";
import { hideOnClose, useImages } from "./windowUtil";
import "./style.css";

/** Philly のキャラのアニメ周期(PersonalThread.h の ANIMATION_INTERVAL = 500ms) */
const ANIMATION_MS = 500;
/** 回転マップの時のタイトルの向き(MakeMap.cpp の DrawDirectionAnime) */
const DIRECTION_TITLE: Record<number, string> = { 0: "【北】", 2: "【東】", 4: "【南】", 6: "【西】" };

/** 押したことにするキー → スキンのカーソル(Philly の MapForm.cpp の Screen->Cursors) */
const SKIN_CURSOR: Record<string, string> = {
  "8": "MouseUp",
  "2": "MouseDown",
  "4": "MouseLeft",
  "6": "MouseRight",
  "8,4": "MouseUpLeft",
  "8,6": "MouseUpRight",
  "2,4": "MouseDownLeft",
  "2,6": "MouseDownRight",
  "7": "MouseTurnLeft",
  "9": "MouseTurnRight",
};

/** キャラの向き(B R F L) → turn の方角 */
const FACING: Record<string, string> = { B: "n", R: "e", F: "s", L: "w" };

const stripTags = (s: string) => s.replace(/\/\*.*?\*\//g, "").trim();

function MapWindow() {
  const [state, setState] = useState<MapState | null>(null);
  const [frame, setFrame] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const image = useImages(() => setLoaded((n) => n + 1));
  const mapCanvas = useRef<HTMLCanvasElement>(null);
  // マップの欄。外周の幅はこの枠の大きさで決める(canvas の大きさは外周の幅で変わるので測らない)
  const mapArea = useRef<HTMLDivElement>(null);
  // HP・MP の減った分を出す為の、1つ前の #status(Philly の OldStatus)
  const prevStatus = useRef<{ session?: number; now?: StatusEvent; old?: StatusEvent }>({});

  useEffect(() => {
    hideOnClose();
    const unlisten = listen<MapState>(MAP_STATE_EVENT, (e) => {
      const s = e.payload;
      trace("map recv");
      // 拡張マップの差分は MapState と一緒に届く。同じ処理の中で足し、1回で描く
      if (s.diffs?.length) {
        for (const d of s.diffs) Object.assign(automapOf(d.world), d.diff);
        setTilesVer((v) => v + 1);
      }
      const p = prevStatus.current;
      // イベントのたびに別のオブジェクトで届くので、中身で比べる。#status が届くたびに1つ前の値になる。
      // タブを切り替えた時は、前のタブのキャラとの差を減った分にしない(#67)
      if (s.session !== p.session) prevStatus.current = { session: s.session, now: s.status, old: s.status };
      else if (JSON.stringify(s.status) !== JSON.stringify(p.now))
        prevStatus.current = { session: s.session, now: s.status, old: p.now ?? s.status };
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
      if (e.type !== "keydown") return;
      trace(`map keydown ${code}${repeat ? " repeat" : ""}`);
      forward({ type: "keydown", code, shiftKey, ctrlKey, altKey, metaKey, repeat });
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKey);
    };
  }, []);

  // 拡張マップ。main 窓が localStorage に貯めた地形を、通常マップの外周に暗くして敷く。
  // 拡大縮小はしないので、外周の幅はマップの欄に等倍で収まる分だけ(最大 AUTOMAP_RING)
  const world = state?.world;
  // 世界ごとの地形。初めて使う時に localStorage から読み、以後は main 窓から届く変わったマスを足す。
  // 世界が変わった直後に届いた分も失わないよう、届いた世界の分に足す
  const automaps = useRef(new Map<string, Tiles>());
  const automapOf = (w: string) => {
    let t = automaps.current.get(w);
    if (!t) automaps.current.set(w, (t = loadTiles(w)));
    return t;
  };
  const [tilesVer, setTilesVer] = useState(0);
  useEffect(() => {
    const unlisten = listen<AutomapDiff>(AUTOMAP_EVENT, (e) => {
      if (e.payload.clear) automaps.current.set(e.payload.world, {});
      Object.assign(automapOf(e.payload.world), e.payload.diff);
      setTilesVer((v) => v + 1);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);
  const tiles = world ? automapOf(world) : {};
  // 実験的: main 窓が位置を予想していれば(ui/src/predict.ts)、予想した位置の地図を記録地図から作って描く
  const raw = state?.map;
  const pred = state?.predict;
  const map = raw && pred && (pred.dx || pred.dy) ? predictedMap(raw, tiles, pred.dx, pred.dy) : raw;
  const [area, setArea] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = mapArea.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ring = ringFor(area.w, area.h - MAP_TOP, CHIP_SIZE);
  // MapState は status などが変わっただけでも新しいオブジェクトで届くので、マップは中身で比べる
  const mapKey = JSON.stringify(map ?? null);
  const automap = useMemo(() => (map ? compose(map, tiles, ring) : null), [mapKey, world, tilesVer, ring]);
  const dim = automap?.dim ?? (map ? gridDim(map.size) : 7);
  const northFix = !map || (map.size === 7 && map.style !== "turn");

  // マップのマウス操作。左ボタンでその向きへ1歩進み、右ボタンで hit(Philly の MapForm.cpp)。押し続けても繰り返さない
  const [cursor, setCursor] = useState("default");
  const mouseDown = useRef(false);
  const sendList = (a: MapListAction) => emitTo("main", MAP_LIST_EVENT, a).catch(console.error);
  const sendMouse = (m: ForwardedMouse) => emitTo("main", MOUSE_EVENT, m).catch(console.error);
  const dirAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // canvas は等倍。マップは上の余白(MAP_TOP)の下から描いている
    const r = e.currentTarget.getBoundingClientRect();
    const size = dim * CHIP_SIZE;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top - MAP_TOP;
    return mouseDir(x, y, size, size, northFix, e.shiftKey || e.ctrlKey);
  };
  // 北固定で Shift か Ctrl を押しながら動かすと、マウスの方を向く(#6)。同じ向きは続けて送らない。
  // 送った向きは今の向きと組で覚え、キーで向きが変わったら同じ向きへもまた送る(#68)
  const lastTurn = useRef<string | null>(null);
  const turnTo = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!northFix || !(e.shiftKey || e.ctrlKey) || mouseDown.current || !map || !state) return;
    const r = e.currentTarget.getBoundingClientRect();
    const size = dim * CHIP_SIZE;
    const to = northFixTurn(e.clientX - r.left, e.clientY - r.top - MAP_TOP, size, size);
    const c = Math.floor(map.size / 2);
    const now = FACING[map.chars.find((ch) => ch.x === c && ch.y === c)?.dir ?? ""];
    if (!to || to === now || `${to}:${now}` === lastTurn.current) return;
    lastTurn.current = `${to}:${now}`;
    sendLine(state.session, `turn ${to}`);
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    turnTo(e);
    const d = dirAt(e);
    // スキンのカーソル。読めなければ CSS の矢印のカーソル
    const skin = d && SKIN_CURSOR[d.keys.join()];
    setCursor(d ? (skin ? `url("${assetUrl("cursor", { name: skin })}"), ${d.cursor}` : d.cursor) : "default");
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
    mouseDown.current = false;
  };
  const direction = northFix ? 0 : (map?.dir ?? 0);

  // タイトル(MakeMap.cpp の DrawDirectionAnime)
  const place = state?.area ? `${state.area} （${state.world ?? ""}）` : "マップ";
  const title = (northFix ? "" : (DIRECTION_TITLE[direction] ?? "")) + place;
  useEffect(() => {
    getCurrentWindow().setTitle(title).catch(console.error);
  }, [title]);

  // 実験的: 自分が進んだ時に、地図を前の位置から滑らかにずらす(表示のメニューで切り替える)。
  // 北固定で、#ex-pos の届く世界だけ。ずらす間は最大 SLIDE_MS、画面の位置がサーバの位置より遅れる
  const [smooth, setSmooth] = useState(false);
  useEffect(() => {
    invoke<Settings>("get_settings")
      .then((s) => setSmooth(s.smoothMove))
      .catch(console.error);
    const unlisten = listen<Settings>(EXPERIMENT_EVENT, (e) => setSmooth(e.payload.smoothMove));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);
  const [slide, setSlide] = useState<{ x: number; y: number } | null>(null);
  const lastPos = useRef<{ world?: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const p = map?.pos;
    if (!p) return;
    const now = { world, x: p.x, y: p.y };
    const step = smooth && northFix ? slideStep(lastPos.current, now) : null;
    lastPos.current = now;
    if (!step) return;
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / SLIDE_MS);
      const k = (1 - t) * CHIP_SIZE;
      setSlide(t >= 1 ? null : { x: step.dx * k, y: step.dy * k });
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      setSlide(null);
    };
  }, [map?.pos?.x, map?.pos?.y, world]);

  useEffect(() => {
    const ctx = mapCanvas.current?.getContext("2d");
    if (!ctx || !map || !state) return;
    trace("map draw");
    // 上の余白を黒で塗り、マップはその下から描く(一番上の行のはみ出しは余白に出る)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ctx.canvas.width, MAP_TOP);
    ctx.translate(0, MAP_TOP);
    const imgs: ImageRefs = {
      chip: image(assetUrl("chip", { mapset: state.mapset })),
      // 1〜3 は #mapset-define のマップセット。決まっていなければスキンの既定のチップ(Philly の DefineChipClear)
      chipOf: (d) => image(assetUrl("chip", { mapset: d === 0 ? state.mapset : (state.defines?.[d] ?? "") })),
      items: image(assetUrl("items")),
      chara: image,
    };
    if (!automap) {
      drawMap(ctx, { size: map.size, mapset: state.mapset, cells: map.cells, chars: map.chars, slide: slide ?? undefined }, imgs, frame);
      return;
    }
    drawMap(
      ctx,
      { size: map.size, dim: automap.dim, mapset: state.mapset, cells: automap.cells, chars: automap.chars, slide: slide ?? undefined },
      imgs,
      frame,
    );
    // 記録地図から描いたマスを暗くし、今見えているマスと見分ける
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    if (slide) ctx.translate(slide.x, slide.y);
    automap.recalled.forEach((on, i) => {
      if (on) ctx.fillRect((i % automap.dim) * CHIP_SIZE, Math.floor(i / automap.dim) * CHIP_SIZE, CHIP_SIZE, CHIP_SIZE);
    });
    // 描き直すのはマップ・地形・アニメ・画像の読み込み・大きさ・ずらす量が変わった時だけ。#status だけの変化では描かない
  }, [mapKey, automap, frame, loaded, state?.mapset, state?.defines?.join(), dim, slide]);

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
          {/* リスト表示中は名前の代わりにリストを出す(Philly.ini の ListInMap=on)。
              左クリックでその行を選び、右クリックでチェックを切り替える。行の外の右クリックはチェックした行を送る */}
          <ul
            className={state?.list ? "name-list list" : "name-list"}
            onContextMenu={(e) => {
              e.preventDefault();
              if (state?.list && e.target === e.currentTarget) sendList({ type: "send" });
            }}
          >
            {(state?.list ? state.list.map(stripTags) : names).map((n, i) => (
              <li
                key={i}
                title={n}
                className={state?.listChecked?.[i] ? "checked" : undefined}
                onClick={state?.list ? () => sendList({ type: "pick", index: i }) : undefined}
                onContextMenu={state?.list ? () => sendList({ type: "toggle", index: i }) : undefined}
              >
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
