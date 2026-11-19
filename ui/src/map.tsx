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
import { isNorthFix, KEY_EVENT, MOUSE_EVENT, RELEASE_ALL, sendLine, sendLines, type ForwardedKey, type ForwardedMouse } from "./keyInput";
import { predictedMap } from "./predict.ts";
import { mouseDir, northFixTurn } from "./mouseDir.ts";
import { addWalk, CHIP_SIZE, MAP_TOP, selfPos, slideStep, viewArea, viewCover, viewFor, walkAt, walkDelay, type WalkSample } from "./mapRender";
import { clampZoom, EXPERIMENT_EVENT, type Settings } from "./settings";
import { MAP_HIDDEN_EVENT, MAP_LIST_EVENT, MAP_STATE_EVENT, PARTY_OPEN_EVENT, type CondEvent, type MapChar, type MapListAction, type MapState, type StatusEvent } from "./protocol";
import { CondBadges, Compass, StatusPanel } from "./StatusPanel";
import { hideOnClose, useImages, useScreenshot } from "./windowUtil";
import { findChar, MAP_POP_EVENT, type Pop, type PopKind } from "./mapPop.ts";
import { Pixels } from "./BagPanel.tsx";
import { COMPASS_PIXELS } from "./pixelIcons.ts";

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

/** スムーズ移動で、地図の周りに余分に描くマス数。見せる位置の遅れ(mapRender.ts の walkDelay)は2マスまで */
const SLIDE_MARGIN = 2;

/** 通れない所へ向かった時の揺れの大きさ(px、等倍)と時間(ms) */
const BUMP_PX = 4;
const BUMP_MS = 120;

/** v6 で求められるマス数の上限。行番号と座標が 10 進 2 桁の為(phi_dm の docs/dev/protocol-v6.md)。外周の2マスを含む */
const V6_MAX = 99;

/** embedded は main 窓の中に置く時。modern はその中で窓いっぱいに描き、名前の欄とステータスの代わりに HUD を重ねる */
export function MapView(props: { embedded?: boolean; modern?: boolean }) {
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
      // keyup も送る。スムーズ移動は、離した知らせで歩くのをやめる(ui/src/walker.ts)
      const type = e.type === "keyup" ? "keyup" : "keydown";
      trace(`map ${type} ${code}${repeat ? " repeat" : ""}`);
      forward({ type, code, shiftKey, ctrlKey, altKey, metaKey, repeat });
    };
    // フォーカスが外れると keyup が届かないので、全部離したとみなす
    const onBlur = () =>
      forward({ type: "keyup", code: RELEASE_ALL, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false });
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const world = state?.world;
  // main 窓が位置を予想していれば(ui/src/predict.ts)、最後の v6 の地図を予想した位置へずらして描く
  const raw = state?.map;
  const pred = state?.predict;
  const map = useMemo(
    () => (raw && pred && (pred.dx || pred.dy) ? predictedMap(raw, pred.dx, pred.dy) : raw),
    [raw, pred?.dx, pred?.dy],
  );
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
  const [variety, setVariety] = useState(false);
  // マップの拡大率。canvas は等倍で描き、CSS で拡大縮小する。v6 の視界は、拡大した大きさで欄に収まる分だけ
  // 拡大率の設定。v6 の地図と、v6 でない 7x7 の地図(v5y など)で別に持つ
  const [zooms, setZooms] = useState({ v6: 1, m57: 1 });
  const zoomSetting = map?.v6 ? zooms.v6 : zooms.m57;
  // 地図を出しているのがこの窓か。もう一方の窓(隠した map 窓など)の大きさで視界を要求しない
  const [shown, setShown] = useState(false);
  const northFix = isNorthFix(map);
  // 拡大率は画面の実際のピクセル(devicePixelRatio)で整数倍に限る(設定は 100・200・300%)。半端な倍率ではドットの幅が揃わず、
  // 名前の文字が崩れる。モダンは窓を覆うマス数を求め、それが v6 の上限(V6_MAX)を超える時だけ倍率を上げる
  const dpr = window.devicePixelRatio || 1;
  let zoomDev = Math.max(1, Math.round(dpr * zoomSetting));
  if (props.modern)
    while (Math.max(viewCover(area.w, (CHIP_SIZE * zoomDev) / dpr), viewCover(area.h, (CHIP_SIZE * zoomDev) / dpr)) + 2 > V6_MAX)
      zoomDev++;
  const zoom = zoomDev / dpr;
  // 画面のピクセルの境目に揃える
  const snap = (v: number) => Math.floor(v * dpr) / dpr;
  const count = props.modern ? viewCover : viewFor;
  // v6 の視界(docs/05-protocol-v6.md の 4.1)。欄に入るマス数を奇数に切り下げる。回転は正方形
  const cell = CHIP_SIZE * zoom;
  const viewW = count(area.w, cell);
  const viewH = count(area.h - MAP_TOP * zoom, cell);
  useEffect(() => {
    if (!shown || area.w === 0 || area.h === 0) return;
    // 窓の端を引きずっている間は送らず、最後に変わってから 300ms 後に送る
    const t = setTimeout(() => invoke("set_map_view", { width: viewW, height: viewH }).catch(console.error), 300);
    return () => clearTimeout(t);
  }, [shown, viewW, viewH]);
  // MapState は status などが変わっただけでも新しいオブジェクトで届くので、マップは中身で比べる
  const mapKey = useMemo(() => JSON.stringify(map ?? null), [map]);
  const square = props.modern ? Math.max(viewW, viewH) : Math.min(viewW, viewH);
  const view = northFix ? { w: viewW, h: viewH } : { w: square, h: square };
  // 盤面は届いた地図のまま描き、窓には view の範囲を見せる(v6 は外周1マスが窓の外)
  const board = useMemo(
    () => map && { ...map, self: selfPos(map.width, map.height, map.style === "turn"), view: viewArea(map, view.w, view.h) },
    [mapKey, view.w, view.h],
  );
  const boardW = board?.view.w ?? 7;
  const boardH = board?.view.h ?? 7;
  // 自キャラと、窓に見えるキャラ。位置は窓の左上を 0 とする
  const me = board ? { x: board.self.x - board.view.x, y: board.self.y - board.view.y } : { x: 3, y: 3 };
  const chars = (board?.chars ?? []).flatMap((c) => {
    const [x, y] = [c.x - board!.view.x, c.y - board!.view.y];
    return x >= 0 && x < boardW && y >= 0 && y < boardH ? [{ ...c, x, y }] : [];
  });

  // マップのマウス操作。左ボタンでその向きへ1歩進み、右ボタンで hit(Philly の MapForm.cpp)。押し続けても繰り返さない。
  // 中ボタン(ホイール)で追尾移動を入り切りする。追尾中はマウスポインタの方へ歩き続ける(Philly に無い)
  const [cursor, setCursor] = useState("default");
  const mouseDown = useRef(false);
  const [follow, setFollow] = useState(false);
  const pointer = useRef<{ x: number; y: number; shiftOrCtrl: boolean } | null>(null);
  const sendList = (a: MapListAction) => emitTo("main", MAP_LIST_EVENT, a).catch(console.error);
  const sendMouse = (m: ForwardedMouse) => emitTo("main", MOUSE_EVENT, m).catch(console.error);
  /** stillOnSelf は、自キャラのマスの上では null を返す(追尾移動で止まる所) */
  const dirAtPoint = (clientX: number, clientY: number, shiftOrCtrl: boolean, stillOnSelf = false) => {
    // canvas の座標に戻す。マップは上の余白(MAP_TOP)の下から描いている。
    // 向きは自キャラのマスから見て決める(回転の自キャラは中央より下)
    const c = mapCanvas.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const [w, h] = [boardW * CHIP_SIZE, boardH * CHIP_SIZE];
    const x = (clientX - r.left) / zoom - (me.x + 0.5) * CHIP_SIZE + w / 2;
    const y = (clientY - r.top) / zoom - MAP_TOP - (me.y + 0.5) * CHIP_SIZE + h / 2;
    if (stillOnSelf && Math.abs(x - w / 2) < CHIP_SIZE / 2 && Math.abs(y - h / 2) < CHIP_SIZE / 2) return null;
    return mouseDir(x, y, w, h, northFix, shiftOrCtrl);
  };
  const dirAt = (e: React.MouseEvent<HTMLCanvasElement>) => dirAtPoint(e.clientX, e.clientY, e.shiftKey || e.ctrlKey);
  // 追尾中は、ポインタの方へ1歩ずつ送り続ける。間引くのは main 窓(歩く速さに合わせる)。
  // 自キャラのマスの上と地図の外では送らない。回転マップの左右の角(その場で向きを変える所)でも送らない
  const followDir = useRef(dirAtPoint);
  followDir.current = dirAtPoint;
  useEffect(() => {
    if (!follow) return;
    // モダンではログや HUD が地図に重なるので、ポインタは窓全体で追う。地図の範囲の外なら mouseDir が null を返す
    const move = (e: MouseEvent) => (pointer.current = { x: e.clientX, y: e.clientY, shiftOrCtrl: e.shiftKey || e.ctrlKey });
    window.addEventListener("mousemove", move);
    const t = setInterval(() => {
      const p = pointer.current;
      const d = p && followDir.current(p.x, p.y, p.shiftOrCtrl, true);
      if (d && !d.keys.some((k) => k === "7" || k === "9")) sendMouse({ type: "follow", keys: d.keys });
    }, 30);
    return () => {
      clearInterval(t);
      window.removeEventListener("mousemove", move);
    };
  }, [follow]);
  // 北固定で Shift か Ctrl を押しながら動かすと、マウスの方を向く(#6)。同じ向きは続けて送らない。
  // 送った向きは今の向きと組で覚え、キーで向きが変わったら同じ向きへもまた送る(#68)
  const lastTurn = useRef<string | null>(null);
  const turnTo = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!northFix || !(e.shiftKey || e.ctrlKey) || mouseDown.current || !map || !state) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [w, h] = [boardW * CHIP_SIZE, boardH * CHIP_SIZE];
    const to = northFixTurn((e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom - MAP_TOP, w, h);
    const now = FACING[chars.find((ch) => ch.x === me.x && ch.y === me.y)?.dir ?? ""];
    if (!to || to === now || `${to}:${now}` === lastTurn.current) return;
    lastTurn.current = `${to}:${now}`;
    sendLine(state.session, `turn ${to}`);
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    pointer.current = { x: e.clientX, y: e.clientY, shiftOrCtrl: e.shiftKey || e.ctrlKey };
    turnTo(e);
    const d = dirAt(e);
    // スキンのカーソル。読めなければ CSS の矢印のカーソル
    const skin = d && SKIN_CURSOR[d.keys.join()];
    setCursor(d ? (skin ? `url("${assetUrl("cursor", { name: skin })}"), ${d.cursor}` : d.cursor) : "default");
  };
  // 隣(上下左右)のキャラを左クリックすると、誘うか仲間の一覧を開くメニューを出す。
  // join は向いている先の相手しか誘えないので、その向きを向いてから送る。回転マップは画面の上が前
  const [charMenu, setCharMenu] = useState<{ left: number; top: number; name: string; turn: string | null } | null>(null);
  useEffect(() => {
    if (!charMenu) return;
    const close = () => setCharMenu(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
    };
  }, [charMenu]);
  const neighborAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = Math.round(((e.clientX - r.left) / zoom - (me.x + 0.5) * CHIP_SIZE) / CHIP_SIZE);
    const dy = Math.round(((e.clientY - r.top) / zoom - MAP_TOP - (me.y + 0.5) * CHIP_SIZE) / CHIP_SIZE);
    if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
    const c = chars.find((ch) => ch.x === me.x + dx && ch.y === me.y + dy && stripTags(ch.name));
    if (!c) return null;
    const turns = northFix ? { "0,-1": "n", "1,0": "e", "0,1": "s", "-1,0": "w" } : { "0,-1": null, "1,0": "r", "0,1": "b", "-1,0": "l" };
    const area = mapArea.current!.getBoundingClientRect();
    return { left: e.clientX - area.left, top: e.clientY - area.top, name: stripTags(c.name), turn: turns[`${dx},${dy}` as keyof typeof turns] };
  };
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0 && !follow && state) {
      const n = neighborAt(e);
      if (n) {
        e.stopPropagation();
        // window の mousedown で閉じる前に開くと、すぐ閉じてしまう
        setTimeout(() => setCharMenu(n));
        return;
      }
    }
    if (e.button === 1) {
      // 中ボタンの自動スクロールと貼り付けを止める
      e.preventDefault();
      pointer.current = { x: e.clientX, y: e.clientY, shiftOrCtrl: e.shiftKey || e.ctrlKey };
      setFollow((f) => !f);
      return;
    }
    if (e.button === 0 && follow) {
      setFollow(false);
      return;
    }
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
  const onMouseLeave = () => {
    mouseDown.current = false;
    pointer.current = null;
  };
  const direction = northFix ? 0 : (map?.dir ?? 0);

  // タイトル(MakeMap.cpp の DrawDirectionAnime)
  const areaName = state?.area ? `${state.area} （${state.world ?? ""}）` : "マップ";
  const title = (northFix ? "" : (DIRECTION_TITLE[direction] ?? "")) + areaName;
  useEffect(() => {
    if (!props.embedded) getCurrentWindow().setTitle(title).catch(console.error);
  }, [title]);

  // 実験的: 自分が進んだ時に、地図を前の位置から滑らかにずらす(表示のメニューで切り替える)。北固定の時だけ
  useEffect(() => {
    const apply = (s: Settings) => {
      setSmooth(s.smoothMove);
      setVariety(s.mapVariety);
      setShown(s.singleWindow || s.modern ? !!props.embedded && !!s.modern === !!props.modern : !props.embedded);
      setZooms({ v6: clampZoom(s.mapZoom) / 100, m57: clampZoom(s.mapZoomM57 || s.mapZoom) / 100 });
    };
    invoke<Settings>("get_settings").then(apply).catch(console.error);
    const unlisten = listen<Settings>(EXPERIMENT_EVENT, (e) => apply(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);
  // 自分の位置は、#v6 G を送るサーバでは main 窓が数えた歩いた分(walk)。1歩を始めた時刻(at)と滑らせる時間(ms)が付き、
  // 今見せている位置から at + ms に新しい位置へ着くように滑らせる(ui/src/walker.ts が、滑りきるまで次の1歩を送らない)。
  // 他の世界は #ex-pos(map.pos)と届いた時刻で、今より少し前の時刻の位置を、届いた位置の間を直線で補って見せる(mapRender.ts の walkAt)
  // ずらす量(px)。滑らせる間は毎フレーム変わるので、state にせず描き直しを直接呼ぶ(React の描き直しを通すと、フレームが落ちる)
  // walkY は揺れを除いた、滑らせる分だけの縦のずれ(px)。前に描く行はこれで決める
  const slide = useRef<{ x: number; y: number; walkY: number } | null>(null);
  const paint = useRef(() => {});
  const lastPos = useRef<{ world?: string; x: number; y: number } | null>(null);
  const walks = useRef<WalkSample[]>([]);
  const raf = useRef(0);
  /** 1歩の時間が付いた位置か(#v6 G のサーバ)。滑らせている途中で変わっても、描く時に今の値を見る */
  const timed = useRef(false);
  const walk = state?.walk;
  const here = walk
    ? { world: `${world}#${walk.epoch}`, x: walk.x, y: walk.y, at: walk.at, ms: walk.ms }
    : map?.pos && { world, x: map.pos.x, y: map.pos.y, at: 0, ms: 0 };
  useEffect(() => {
    if (!here) return;
    const step = smooth && northFix ? slideStep(lastPos.current, here) : null;
    lastPos.current = here;
    const s = { at: here.at || performance.timeOrigin + performance.now(), x: here.x, y: here.y };
    if (!step) {
      // 飛んだ時と、滑らせない時はすぐに描く
      walks.current = [s];
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      slide.current = null;
      paint.current();
      return;
    }
    timed.current = here.ms > 0;
    if (timed.current) {
      // 今見せている位置から、main 窓の1歩の終わる時刻に着くように滑らせる。届くのが遅れても跳ばない
      const now = performance.timeOrigin + performance.now();
      const from = walks.current.length ? walkAt(walks.current, now) : { x: s.x - step.dx, y: s.y - step.dy };
      walks.current = [
        { at: now, ...from },
        { at: Math.max(now + 16, here.at + here.ms), x: s.x, y: s.y },
      ];
    } else walks.current = addWalk(walks.current, s);
    animate.current();
  }, [here?.world, here?.x, here?.y]);
  // 通れない所へ向かった1歩は、その場で BUMP_PX だけ進んで戻る揺れを見せる(predict.ts の walkStep)
  const bump = useRef<{ dx: number; dy: number; start: number } | null>(null);
  useEffect(() => {
    const b = walk?.bump;
    if (!b || !smooth || !northFix) return;
    bump.current = { dx: b.dx, dy: b.dy, start: performance.timeOrigin + performance.now() };
    animate.current();
  }, [walk?.bump?.at]);
  // 滑らせる量と揺れを足して、毎フレーム描く。どちらも終われば止める
  const animate = useRef(() => {});
  animate.current = () => {
    if (raf.current) return;
    const tick = () => {
      const now = performance.timeOrigin + performance.now();
      let [sx, sy, done] = [0, 0, true];
      let walkY = 0;
      const ws = walks.current;
      const last = ws[ws.length - 1];
      if (last) {
        const d = walkAt(ws, now - (timed.current ? 0 : walkDelay(ws)));
        if (d.x !== last.x || d.y !== last.y) [sx, sy, done] = [(last.x - d.x) * CHIP_SIZE, (last.y - d.y) * CHIP_SIZE, false];
        walkY = sy;
      }
      const b = bump.current;
      const t = b ? (now - b.start) / BUMP_MS : 1;
      if (b && t < 1) {
        // 自キャラが壁の方へ寄って見えるよう、地図を逆へずらす
        const k = Math.sin(Math.PI * t) * BUMP_PX;
        [sx, sy, done] = [sx - b.dx * k, sy - b.dy * k, false];
      } else bump.current = null;
      // 整数の px にする。端数の位置に描くと、チップの境目が隣と混ざって線に見える
      slide.current = done ? null : { x: Math.round(sx), y: Math.round(sy), walkY: Math.round(walkY) };
      paint.current();
      raf.current = done ? 0 : requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // 滑らせる間は、周りに SLIDE_MARGIN マス広く描いた地図(自キャラ以外)を layers に1回描き、毎フレームはそれをずらして写して
  // 自キャラを描く。毎フレーム全部のマスを描くと、遅い WebView(WebKitGTK)では 60fps に間に合わない。
  // 地図は自キャラより後ろの行と前の行に分け、後ろ → 自キャラ → 前 の順に重ねる。止まっている時と同じく、下の行の壁が自キャラに重なる
  const layers = useRef<{ back: HTMLCanvasElement; front: HTMLCanvasElement; split: number } | null>(null);
  const layerDirty = useRef(true);
  paint.current = () => {
    const ctx = mapCanvas.current?.getContext("2d");
    if (!ctx || !board || !state) return;
    const t0 = performance.now();
    const s = slide.current;
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
    // 揺らぎは北固定の時だけ。自キャラの世界の座標は #ex-pos、無ければ #v6 G で数えた位置
    const selfAt = map?.pos ?? (state.walk && { x: state.walk.x, y: state.walk.y });
    const origin = variety && northFix && selfAt ? { x: selfAt.x - board.self.x, y: selfAt.y - board.self.y } : undefined;
    const input = { ...board, mapset: state.mapset, origin };
    if (!s) {
      drawMap(ctx, input, imgs, frame);
      trace(`map draw ${(performance.now() - t0).toFixed(1)}ms`);
      return;
    }
    const m = SLIDE_MARGIN * CHIP_SIZE;
    const [w, h] = [ctx.canvas.width, ctx.canvas.height];
    // 前に描く行。自キャラの絵(1マス)より下にある最初の行から。上下に滑らせる間は、自キャラは行の間にいる。
    // 揺れ(BUMP_PX)では行を変えない。南へ揺れた時に、南の行(塞いでいる物)が後ろに回って自キャラの下に描かれた為
    const split = Math.ceil(board.self.y - s.walkY / CHIP_SIZE) + 1;
    if (layerDirty.current || !layers.current || layers.current.split !== split) {
      const ls = (layers.current ??= { back: document.createElement("canvas"), front: document.createElement("canvas"), split });
      ls.split = split;
      const v = board.view;
      const wide = { x: v.x - SLIDE_MARGIN, y: v.y - SLIDE_MARGIN, w: v.w + 2 * SLIDE_MARGIN, h: v.h + 2 * SLIDE_MARGIN };
      for (const part of ["back", "front"] as const) {
        const l = ls[part];
        [l.width, l.height] = [w + 2 * m, h + 2 * m];
        const lc = l.getContext("2d")!;
        lc.setTransform(1, 0, 0, 1, 0, 0);
        lc.imageSmoothingEnabled = false;
        lc.clearRect(0, 0, l.width, l.height);
        lc.translate(0, MAP_TOP);
        drawMap(lc, { ...input, view: wide, only: "others", split: { row: split, part } }, imgs, frame);
      }
      layerDirty.current = false;
    }
    // 上の余白は止まっている時と同じく透明にし、地図の部分だけを写す
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const [sx, sy] = [m - Math.max(-m, Math.min(m, s.x)), m - Math.max(-m, Math.min(m, s.y))];
    const blit = (l: HTMLCanvasElement) => ctx.drawImage(l, sx, sy + MAP_TOP, w, h - MAP_TOP, 0, MAP_TOP, w, h - MAP_TOP);
    blit(layers.current.back);
    ctx.translate(0, MAP_TOP);
    drawMap(ctx, { ...input, only: "self" }, imgs, frame);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    blit(layers.current.front);
    trace(`map slide ${(performance.now() - t0).toFixed(1)}ms`);
  };
  // 描き直すのはマップ・地形・アニメ・画像の読み込み・大きさが変わった時だけ。#status だけの変化では描かない。
  // ずらす量が変わった時は、滑らせる処理が paint を直接呼ぶ
  useEffect(() => {
    layerDirty.current = true;
    paint.current();
  }, [board, frame, loaded, state?.mapset, state?.defines?.join(), variety]);

  const canvasLeft = snap((area.w - boardW * CHIP_SIZE * zoom) / 2);
  const canvasTop = snap((area.h - (boardH * CHIP_SIZE + MAP_TOP) * zoom) / 2);
  popCharsRef.current = { chars, me };
  // 同じキャラに続けて出た数字は、上へずらして重ねない
  const stack = new Map<string, number>();
  const popEls = pops.flatMap((p) => {
    const c = p.at ?? findChar(chars, p.name, me);
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
    const by = p.by ? findChar(chars, p.by, me) : undefined;
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
  const names = chars
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.y - b.c.y || a.i - b.i)
    .map(({ c }) => stripTags(c.name))
    .filter((n) => n);
  return (
    <div className={props.modern ? "map-window modern" : "map-window"}>
      {/* main 窓の中では窓のタイトルに出せないので、地図の上に出す */}
      {props.embedded && !props.modern && <div className="map-title">{title}</div>}
      {props.modern && <ModernHud title={title} now={prevStatus.current.now} cond={state?.cond} dir={direction} northFix={northFix} />}
      <div className="map-row">
        <div className="map-area" ref={mapArea}>
          <canvas
            ref={mapCanvas}
            width={boardW * CHIP_SIZE}
            height={boardH * CHIP_SIZE + MAP_TOP}
            // 中央に置く。位置を整数にして、半ピクセルずれて画像がにじまないようにする
            style={{
              cursor,
              width: boardW * CHIP_SIZE * zoom,
              height: (boardH * CHIP_SIZE + MAP_TOP) * zoom,
              imageRendering: zoom === 1 ? undefined : "pixelated",
              left: canvasLeft,
              top: canvasTop,
            }}
            onMouseMove={onMouseMove}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            onContextMenu={(e) => e.preventDefault()}
          />
          {popEls}
          {charMenu && state && (
            <div className="char-menu" style={{ left: charMenu.left, top: charMenu.top }} onMouseDown={(e) => e.stopPropagation()}>
              <div className="char-menu-name">{charMenu.name}</div>
              {state.party?.includes(charMenu.name) ? (
                <button
                  type="button"
                  onClick={() => {
                    emitTo("main", PARTY_OPEN_EVENT).catch(console.error);
                    setCharMenu(null);
                  }}
                >
                  パーティの一覧
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    sendLines(state.session, charMenu.turn ? `turn ${charMenu.turn}\njoin` : "join");
                    setCharMenu(null);
                  }}
                >
                  パーティに誘う
                </button>
              )}
            </div>
          )}
          {follow && <div className="map-follow">追尾移動中(中クリックか左クリックで止める)</div>}
        </div>
        {!props.modern && (
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
        )}
      </div>
      {!props.modern && (
      <>
      <StatusPanel
        session={state?.session ?? -1}
        now={prevStatus.current.now}
        old={prevStatus.current.old}
        cond={state?.cond}
      />
      <div className="map-status-bar">
        <CondBadges cond={state?.cond} />
      </div>
      </>
      )}
    </div>
  );
}

/** モダンの左上の地名と HP・MP、右上の方角。文字は白に黒の縁取り(style.css の .modern-hud) */
function ModernHud(props: { title: string; now?: StatusEvent; cond?: CondEvent; dir: number; northFix: boolean }) {
  const s = props.now;
  const bar = (kind: "hp" | "mp", v = 0, max = 0) => (
    <div className={`modern-bar ${kind}`}>
      <i style={{ width: `${max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0}%` }} />
      <span>
        <span>{kind.toUpperCase()}</span>
        <span>
          {v} / {max}
        </span>
      </span>
    </div>
  );
  return (
    <>
      <div className="modern-hud">
        <div className="modern-place">{props.title}</div>
        {bar("hp", s?.hp, s?.maxHp)}
        {bar("mp", s?.mp, s?.maxMp)}
        <CondBadges cond={props.cond} />
      </div>
      {/* カバンとステータスのボタンと同じ丸に、ドット絵の針を描く。北固定でない地図は向きに合わせて回す */}
      <div className="modern-compass" title={props.northFix ? "北固定" : "回転"}>
        <div style={{ transform: `rotate(${props.dir * 45}deg)` }}>
          <Pixels rows={COMPASS_PIXELS} size={32} />
        </div>
      </div>
    </>
  );
}
