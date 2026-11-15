// map 窓(Philly の MapForm)。アクティブなタブのマップとステータスを表示する。
// 状態は main 窓から MAP_STATE_EVENT で届く。窓の起動は mapMain.tsx。
// 「マップをログと同じ窓に出す」の時は、main 窓が embedded で中に置く。届くイベントの to で、どちらに宛てた物かを見分ける。
//
// 配置は MapForm.dfm に合わせた。マップ(等倍で中央)、右に方角とキャラ名の一覧(ImageMapSide)、
// 下にステータス(ImageStatus)、一番下に状態異常のステータスバー。
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "./asset";
import { drawMap, type ImageRefs } from "./drawMap";
import { trace } from "./trace.ts";
import { isNorthFix, KEY_EVENT, MOUSE_EVENT, sendLine, type ForwardedKey, type ForwardedMouse } from "./keyInput";
import { predictedMap } from "./predict.ts";
import { mouseDir, northFixTurn } from "./mouseDir.ts";
import { CHIP_SIZE, MAP_TOP, SLIDE_MS, fitBoard, slideStep, viewFor } from "./mapRender";
import { clampZoom, EXPERIMENT_EVENT, type Settings } from "./settings";
import { MAP_HIDDEN_EVENT, MAP_LIST_EVENT, MAP_STATE_EVENT, type MapChar, type MapListAction, type MapState, type StatusEvent } from "./protocol";
import { CondBadges, Compass, StatusPanel } from "./StatusPanel";
import { hideOnClose, useImages, useScreenshot } from "./windowUtil";
import { findChar, MAP_POP_EVENT, type Pop, type PopKind } from "./mapPop.ts";

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

/** 吹き出しと増減の数字を出す時間 */
const TALK_MS = 4000;
const AMOUNT_MS = 1200;

/** 吹き出しの下に浮かせる文字の色(style.css) */
const AMOUNT_CLASS: Partial<Record<PopKind, string>> = {
  "-hp": "h-down",
  "+hp": "h-up",
  "-mp": "m-down",
  "+mp": "m-up",
  miss: "miss",
  poison: "poison",
  palsy: "palsy",
  buff: "buff",
  debuff: "debuff",
};

/** MAP_STATE_EVENT などの宛先。main 窓の中に置いた地図なら "main" */
export type MapPlace = "map" | "main";

export function MapView(props: { embedded?: boolean }) {
  const place: MapPlace = props.embedded ? "main" : "map";
  const [state, setState] = useState<MapState | null>(null);
  const [frame, setFrame] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const image = useImages(() => setLoaded((n) => n + 1));
  const mapCanvas = useRef<HTMLCanvasElement>(null);
  useScreenshot("map", mapCanvas, place);
  // マップの欄。v6 の視界の大きさはこの枠の大きさで決める(canvas の大きさは視界で変わるので測らない)
  const mapArea = useRef<HTMLDivElement>(null);
  // HP・MP の減った分を出す為の、1つ前の #status(Philly の OldStatus)
  const prevStatus = useRef<{ session?: number; now?: StatusEvent; old?: StatusEvent }>({});

  useEffect(() => {
    // 隠している間は main 窓が送らない(#75)
    if (!props.embedded) hideOnClose(() => emitTo("main", MAP_HIDDEN_EVENT).catch(console.error));
    const unlisten = listen<MapState & { to?: MapPlace }>(MAP_STATE_EVENT, (e) => {
      const s = e.payload;
      if ((s.to ?? "map") !== place) return;
      trace("map recv");
      const p = prevStatus.current;
      // イベントのたびに別のオブジェクトで届くので、中身で比べる。#status が届くたびに1つ前の値になる。
      // タブを切り替えた時は、前のタブのキャラとの差を減った分にしない(#67)
      if (s.session !== p.session) prevStatus.current = { session: s.session, now: s.status, old: s.status };
      else if (JSON.stringify(s.status) !== JSON.stringify(p.now))
        prevStatus.current = { session: s.session, now: s.status, old: p.now ?? s.status };
      setState(s);
    });
    // 開いた直後の状態を main 窓に求める
    unlisten.then(() => emitTo("main", "phi-map-ready", place));
    const timer = setInterval(() => setFrame((f) => f ^ 1), ANIMATION_MS);
    return () => {
      unlisten.then((f) => f());
      clearInterval(timer);
    };
  }, []);

  // マップ窓で押したキーは main 窓へ送り、そこで操作にする(Philly も FormMap のキーを KeyDown に回す)
  useEffect(() => {
    // main 窓の中なら、キーは main 窓がそのまま受ける
    if (props.embedded) return;
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

  const world = state?.world;
  // main 窓が位置を予想していれば(ui/src/predict.ts)、最後の v6 の地図を予想した位置へずらして描く
  const raw = state?.map;
  const pred = state?.predict;
  const map = raw && pred && (pred.dx || pred.dy) ? predictedMap(raw, pred.dx, pred.dy) : raw;
  const [area, setArea] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = mapArea.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // キャラの上に出す吹き出しと増減の数字(ui/src/mapPop.ts)。キャラが動いても付いて行くよう、位置は描く時に名前で探す
  const [pops, setPops] = useState<(Pop & { id: number; at?: { x: number; y: number } })[]>([]);
  // 倒されたキャラはすぐ地図から消えるので、届いた時の位置を覚えて出す
  const popCharsRef = useRef<{ chars: MapChar[]; me: { x: number; y: number } }>({ chars: [], me: { x: 0, y: 0 } });
  useEffect(() => {
    let id = 0;
    const unlisten = listen<{ pops: Pop[]; to: MapPlace }>(MAP_POP_EVENT, (e) => {
      if (e.payload.to !== place) return;
      const { chars, me } = popCharsRef.current;
      const added = e.payload.pops.flatMap((p) => {
        if (p.kind !== "dead") return [{ ...p, id: ++id }];
        const c = findChar(chars, p.name, me);
        return c ? [{ ...p, id: ++id, at: { x: c.x, y: c.y } }] : [];
      });
      // 吹き出しは1人に1つ。新しい発言で置き換える
      const talkers = new Set(added.filter((p) => p.kind === "talk").map((p) => p.name));
      setPops((ps) => [...ps.filter((p) => !(p.kind === "talk" && talkers.has(p.name))), ...added]);
      for (const p of added)
        setTimeout(() => setPops((ps) => ps.filter((q) => q.id !== p.id)), p.kind === "talk" ? TALK_MS : AMOUNT_MS);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);
  const [smooth, setSmooth] = useState(false);
  // マップの拡大率。canvas は等倍で描き、CSS で拡大縮小する。v6 の視界は、拡大した大きさで欄に収まる分だけ
  const [zoom, setZoom] = useState(1);
  // 地図を出しているのがこの窓か。もう一方の窓(隠した map 窓など)の大きさで視界を要求しない
  const [shown, setShown] = useState(false);
  const northFix = isNorthFix(map);
  // v6 の視界(docs/05-protocol-v6.md の 4.1)。欄に入るマス数を奇数に切り下げる。回転は正方形
  const cell = CHIP_SIZE * zoom;
  const viewW = viewFor(area.w, cell);
  const viewH = viewFor(area.h - MAP_TOP * zoom, cell);
  useEffect(() => {
    if (!shown || area.w === 0 || area.h === 0) return;
    // 窓の端を引きずっている間は送らず、最後に変わってから 300ms 後に送る
    const t = setTimeout(() => invoke("set_map_view", { width: viewW, height: viewH }).catch(console.error), 300);
    return () => clearTimeout(t);
  }, [shown, viewW, viewH]);
  // MapState は status などが変わっただけでも新しいオブジェクトで届くので、マップは中身で比べる
  const mapKey = JSON.stringify(map ?? null);
  const view = northFix ? { w: viewW, h: viewH } : { w: Math.min(viewW, viewH), h: Math.min(viewW, viewH) };
  // サーバが要求より小さい v6 の地図を返した時は、中央に置いて外側を '?' で埋める
  const board = useMemo(() => (map ? fitBoard(map, view.w, view.h) : null), [mapKey, view.w, view.h]);
  const boardW = board?.width ?? 7;
  const boardH = board?.height ?? 7;
  const me = board?.self ?? { x: 3, y: 3 };

  // マップのマウス操作。左ボタンでその向きへ1歩進み、右ボタンで hit(Philly の MapForm.cpp)。押し続けても繰り返さない
  const [cursor, setCursor] = useState("default");
  const mouseDown = useRef(false);
  const sendList = (a: MapListAction) => emitTo("main", MAP_LIST_EVENT, a).catch(console.error);
  const sendMouse = (m: ForwardedMouse) => emitTo("main", MOUSE_EVENT, m).catch(console.error);
  const dirAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // canvas の座標に戻す。マップは上の余白(MAP_TOP)の下から描いている。
    // 向きは自キャラのマスから見て決める(回転の自キャラは中央より下)
    const r = e.currentTarget.getBoundingClientRect();
    const [w, h] = [boardW * CHIP_SIZE, boardH * CHIP_SIZE];
    const x = (e.clientX - r.left) / zoom - (me.x + 0.5) * CHIP_SIZE + w / 2;
    const y = (e.clientY - r.top) / zoom - MAP_TOP - (me.y + 0.5) * CHIP_SIZE + h / 2;
    return mouseDir(x, y, w, h, northFix, e.shiftKey || e.ctrlKey);
  };
  // 北固定で Shift か Ctrl を押しながら動かすと、マウスの方を向く(#6)。同じ向きは続けて送らない。
  // 送った向きは今の向きと組で覚え、キーで向きが変わったら同じ向きへもまた送る(#68)
  const lastTurn = useRef<string | null>(null);
  const turnTo = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!northFix || !(e.shiftKey || e.ctrlKey) || mouseDown.current || !map || !state) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [w, h] = [boardW * CHIP_SIZE, boardH * CHIP_SIZE];
    const to = northFixTurn((e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom - MAP_TOP, w, h);
    const now = FACING[board?.chars.find((ch) => ch.x === me.x && ch.y === me.y)?.dir ?? ""];
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
  const areaName = state?.area ? `${state.area} （${state.world ?? ""}）` : "マップ";
  const title = (northFix ? "" : (DIRECTION_TITLE[direction] ?? "")) + areaName;
  useEffect(() => {
    if (!props.embedded) getCurrentWindow().setTitle(title).catch(console.error);
  }, [title]);

  // 実験的: 自分が進んだ時に、地図を前の位置から滑らかにずらす(表示のメニューで切り替える)。
  // 北固定で、#ex-pos の届く世界だけ。ずらす間は最大 SLIDE_MS、画面の位置がサーバの位置より遅れる
  useEffect(() => {
    const apply = (s: Settings) => {
      setSmooth(s.smoothMove);
      setShown(s.singleWindow === !!props.embedded);
      setZoom(clampZoom(s.mapZoom) / 100);
    };
    invoke<Settings>("get_settings").then(apply).catch(console.error);
    const unlisten = listen<Settings>(EXPERIMENT_EVENT, (e) => apply(e.payload));
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
      // 整数の px にする。端数の位置に描くと、チップの境目が隣と混ざって線に見える
      setSlide(t >= 1 ? null : { x: Math.round(step.dx * k), y: Math.round(step.dy * k) });
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
    if (!ctx || !board || !state) return;
    trace("map draw");
    // 上の余白は透明にし、マップはその下から描く(一番上の行のはみ出しは余白に出る)。
    // 余白と地図の外は欄の灰色にして、地図の中の何も無い黒いマスと見分けられるようにする
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ctx.canvas.width, MAP_TOP);
    ctx.translate(0, MAP_TOP);
    const imgs: ImageRefs = {
      chip: image(assetUrl("chip", { mapset: state.mapset })),
      // 1〜3 は #mapset-define のマップセット。決まっていなければスキンの既定のチップ(Philly の DefineChipClear)
      chipOf: (d) => image(assetUrl("chip", { mapset: d === 0 ? state.mapset : (state.defines?.[d] ?? "") })),
      items: image(assetUrl("items")),
      chara: image,
    };
    drawMap(ctx, { ...board, mapset: state.mapset, slide: slide ?? undefined }, imgs, frame);
    // 描き直すのはマップ・地形・アニメ・画像の読み込み・大きさ・ずらす量が変わった時だけ。#status だけの変化では描かない
  }, [board, frame, loaded, state?.mapset, state?.defines?.join(), slide]);

  const canvasLeft = Math.floor((area.w - boardW * CHIP_SIZE * zoom) / 2);
  const canvasTop = Math.floor((area.h - (boardH * CHIP_SIZE + MAP_TOP) * zoom) / 2);
  const popChars = board?.chars ?? [];
  popCharsRef.current = { chars: popChars, me };
  // 同じキャラに続けて出た数字は、上へずらして重ねない
  const stack = new Map<string, number>();
  const popEls = pops.flatMap((p) => {
    const c = p.at ?? findChar(popChars, p.name, me);
    if (!c) return [];
    if (p.kind === "dead")
      return [
        <div
          key={p.id}
          className="map-dead"
          style={{
            left: canvasLeft + (c.x * CHIP_SIZE + CHIP_SIZE / 2) * zoom,
            top: canvasTop + (MAP_TOP + c.y * CHIP_SIZE + CHIP_SIZE / 2) * zoom,
            width: CHIP_SIZE * 1.6 * zoom,
            height: CHIP_SIZE * 1.6 * zoom,
          }}
        />,
      ];
    const n = p.kind === "talk" ? 0 : (stack.get(p.name) ?? 0);
    if (p.kind !== "talk") stack.set(p.name, n + 1);
    const style = {
      left: canvasLeft + (c.x * CHIP_SIZE + CHIP_SIZE / 2) * zoom,
      // 吹き出しは頭の上、数字は胴から浮かせる
      top: canvasTop + (MAP_TOP + c.y * CHIP_SIZE + (p.kind === "talk" ? 0 : CHIP_SIZE / 2)) * zoom - n * 14,
    };
    // 攻撃した時の演出。魔法なら攻撃したキャラから魔法弾を飛ばし、武器なら受けたキャラの上に斬撃を出す
    const fx: React.ReactNode[] = [];
    // 強化は足元から光が立ち上り、弱体は上から沈む
    if ((p.kind === "buff" || p.kind === "debuff") && n === 0)
      fx.push(
        <div
          key={`${p.id}a`}
          className={`map-aura ${p.kind}`}
          style={{
            left: style.left,
            top: canvasTop + (MAP_TOP + (c.y + 1) * CHIP_SIZE) * zoom,
            width: CHIP_SIZE * zoom,
            height: CHIP_SIZE * 1.4 * zoom,
          }}
        />,
      );
    const by = p.by ? findChar(popChars, p.by, me) : undefined;
    if (by && by !== c && n === 0) {
      const dx = (c.x - by.x) * CHIP_SIZE * zoom;
      const dy = (c.y - by.y) * CHIP_SIZE * zoom;
      const at = { left: style.left, top: canvasTop + (MAP_TOP + c.y * CHIP_SIZE + CHIP_SIZE / 2) * zoom };
      const vars = { "--a": `${(Math.atan2(dy, dx) * 180) / Math.PI}deg`, "--dx": `${dx}px`, "--dy": `${dy}px` };
      if (!p.magic)
        fx.push(<div key={`${p.id}s`} className="map-slash" style={{ ...at, ...vars } as React.CSSProperties} />);
      else
        fx.push(
          <div key={`${p.id}b`} className="map-bolt" style={{ left: at.left - dx, top: at.top - dy, ...vars } as React.CSSProperties} />,
          <div key={`${p.id}x`} className="map-burst" style={at} />,
        );
    }
    return [
      ...fx,
      <div key={p.id} className={p.kind === "talk" ? "map-talk" : `map-amount ${AMOUNT_CLASS[p.kind] ?? ""}`} style={style}>
        {p.kind[0] === "+" ? `+${p.text}` : p.text}
      </div>,
    ];
  });

  // 名前の一覧は上の行から順に並べる(CharacterNameList.cpp の SetNameList)
  const names = (map?.chars ?? [])
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.y - b.c.y || a.i - b.i)
    .map(({ c }) => stripTags(c.name))
    .filter((n) => n);
  return (
    <div className="map-window">
      {/* main 窓の中では窓のタイトルに出せないので、地図の上に出す */}
      {props.embedded && <div className="map-title">{title}</div>}
      <div className="map-row">
        <div className="map-area" ref={mapArea}>
          <canvas
            ref={mapCanvas}
            width={boardW * CHIP_SIZE}
            height={boardH * CHIP_SIZE + MAP_TOP}
            // 中央に置く。位置を整数にして、半ピクセルずれて画像がにじまないようにする
            style={{
              cursor,
              width: Math.round(boardW * CHIP_SIZE * zoom),
              height: Math.round((boardH * CHIP_SIZE + MAP_TOP) * zoom),
              imageRendering: zoom === 1 ? undefined : "pixelated",
              left: canvasLeft,
              top: canvasTop,
            }}
            onMouseMove={onMouseMove}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onContextMenu={(e) => e.preventDefault()}
          />
          {popEls}
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
