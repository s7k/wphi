import { Channel, invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { afterSend, caretLine, prepareLine } from "./chat.ts";
import { SENT_EVENT } from "./keyInput";
import { isTextTarget, KEY_EVENT, MOUSE_EVENT, type ForwardedMouse, keyContext, runKeyAction, sendLine, sendLines, type ForwardedKey } from "./keyInput";
import { keyAction, listKeyAction, menuAction, moveInput, type AskOptions } from "./keys.ts";
import { AskDialog } from "./AskDialog";
import { assetUrl } from "./asset";
import { absorb, AUTOMAP_EVENT, loadTiles, removeTiles, saveTiles, type AutomapDiff, type Tiles } from "./automap.ts";
import { BoardEditor } from "./BoardEditor";
import { DEFAULT_SETTINGS, shortcutText, type Settings } from "./settings.ts";
import { SettingsPanel } from "./SettingsPanel";
import { NewCharacter } from "./NewCharacter";
import { capConvs, partnersKey, privLines, privPartners, usersFromEvent, type User } from "./priv.ts";
import { PrivPanel, type PrivConv } from "./PrivPanel";
import { ListOverlay } from "./ListOverlay";
import { listNo, listOk, moreNo, newList, type ListState } from "./list.ts";
import { MoveRepeat } from "./moveRepeat.ts";
import { EAGLE_EYE_EVENT, MAP_LIST_EVENT, MAP_STATE_EVENT, type MapListAction, type MapState, type UiEvent } from "./protocol";
import { Window } from "@tauri-apps/api/window";
import { LogLines } from "./LogLineList";
import { pushLine, type LogLine } from "./logLines.ts";

// src-tauri/src/characters.rs の Store
type Character = { label: string; host: string; port: number };
type Store = { characters: Character[]; openTabs: string[] };

/** 最後の #user からこれだけ何も届かなければ、#ulist の返事が届き終わった事にする */
const ULIST_QUIET_MS = 300;

type Tab = {
  session: number;
  label: string;
  /** ログ欄の HTML。1要素が1行 */
  lines: LogLine[];
  closed: boolean;
  /** 表示中のリスト(#list 〜 #end-list) */
  list: ListState | null;
  /** 看板エディタを開いているか */
  board: boolean;
  /** #name で届いた自分の名前(priv の振り分けに使う) */
  self: string;
  /** #user の一覧(priv の番号に使う) */
  users: User[];
  privs: PrivConv[];
  privOpen: boolean;
  privActive: string | null;
  /** ログを保存しているか(Philly の LogAutoSave。タブごとに切り替える) */
  logSave: boolean;
  /** 裏にいる間に発言か priv が届いた */
  unread: boolean;
  /** 裏にいる間に HP か MP が減った */
  hurt: boolean;
};

/**
 * リストの受信の状態。受信の順番に関わるので、再描画を待たない ref で持つ。
 * cancel は次に届くリストを出さない数(Philly の NextListCancelCount)、started は #list を受けて #end-list を待っている事
 */
type ListFlow = { cancel: number; started: boolean };

/** Philly のログバッファに合わせ、古い行から捨てる */

function timePrefix(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `<font class="class_time">${hh}:${mm} </font>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function systemOk(message: string): string {
  return `<font class="class_system_ok">${escapeHtml(message)}</font>`;
}

/** ログを利用者の地域の日付のファイルに足す。保存先のパスを返す */
function saveLog(label: string, line: string, asHtml: boolean): Promise<string | void> {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return invoke<string>("append_log", { label, date, html: line, asHtml }).catch((e) => console.error(e));
}

function systemNg(message: string): string {
  return `<font class="class_system_ng">${escapeHtml(message)}</font>`;
}

/** Log.css は Philly では IE の別文書に当てていた。body をログ欄に読み替えて使う */
function scopeLogCss(css: string): string {
  return css.replace(/(^|[\s,}])body(?=[\s,{])/g, "$1.phi-log");
}

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [logCss, setLogCss] = useState("");
  const [store, setStore] = useState<Store>({ characters: [], openTabs: [] });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 語や数を聞いている間のダイアログ(AskDialog)。答えは resolve で返す
  const [asking, setAsking] = useState<{ opts: AskOptions; resolve: (text: string | null) => void } | null>(null);
  const ask = (opts: AskOptions) => new Promise<string | null>((resolve) => setAsking({ opts, resolve }));
  // ログを最下行に固定する(既定 on。off は Philly の「ログスクロール停止」)
  const [logFollow, setLogFollow] = useState(true);
  useEffect(() => {
    invoke<Settings>("get_settings").then(setSettings).catch(console.error);
  }, []);
  const [error, setError] = useState("");

  const reload = () =>
    invoke<Store>("list_characters")
      .then((s) => {
        setStore(s);
        return s;
      })
      .catch((e) => {
        setError(String(e));
        return null;
      });

  // 起動時に、前回開いていたタブへ接続し直す(Philly の TabSession.ini)。
  // StrictMode は開発時に effect を2回呼ぶので、1回だけにする
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    invoke<string>("log_css")
      .then((css) => setLogCss(scopeLogCss(css)))
      .catch((e) => console.error(e));
    reload().then((s) => s?.openTabs.forEach((label) => connect(label)));
  }, []);

  // 開いているタブを保存する。起動直後の空の一覧で上書きしないよう、最初のタブが開くまで待つ
  const opened = useRef(false);
  useEffect(() => {
    if (tabs.length > 0) opened.current = true;
    if (!opened.current) return;
    invoke("set_open_tabs", { labels: tabs.map((t) => t.label) }).catch((e) => console.error(e));
  }, [tabs.map((t) => t.label).join("\n")]);

  // タブごとのマップとステータス。map 窓にはアクティブなタブの分だけ送る
  const mapStates = useRef(new Map<number, MapState>());
  const activeRef = useRef<number | null>(null);
  activeRef.current = active;
  // map 窓へは 16ms にまとめて送る。#m57 と #status がそれぞれ 0.2 秒ごとに届き、1つ届くたびに MapState 全体を送っていた
  const mapStateTimer = useRef<number | undefined>(undefined);
  const mapStateSession = useRef<number | null>(null);
  const sendMapState = (session: number | null) => {
    mapStateSession.current = session;
    mapStateTimer.current ??= window.setTimeout(() => {
      mapStateTimer.current = undefined;
      const s = mapStateSession.current;
      const state = s === null ? undefined : mapStates.current.get(s);
      emitTo("map", MAP_STATE_EVENT, state ?? { session: -1, mapset: "" }).catch((e) => console.error(e));
    }, 16);
  };
  useEffect(() => sendMapState(active), [active]);
  // 前に出したタブの未読の印を消す
  useEffect(() => {
    if (active !== null) update(active, (t) => (t.unread || t.hurt ? { ...t, unread: false, hurt: false } : t));
  }, [active]);
  // リンクで WebView を遷移させず、既定のブラウザで開く。ログ・priv・看板のプレビューのどこで押しても同じにする。
  // 遷移させると main 窓が外部のページに置き換わり、ID の入力を求める偽の画面に使える(#49)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest("a");
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("href");
      if (href && /^https?:\/\//.test(href)) openUrl(href).catch(console.error);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    // 開いたばかりの map 窓は localStorage から地形を読むので、先に書いておく
    const unlisten = listen("phi-map-ready", () => {
      flushAutomaps();
      sendMapState(activeRef.current);
    });
    window.addEventListener("beforeunload", flushAutomaps);
    return () => {
      unlisten.then((f) => f());
      window.removeEventListener("beforeunload", flushAutomaps);
    };
  }, []);

  // 入力欄の外で押したキーは Philly の操作にする(MainForm.cpp の ApplicationEventsMessage)。
  // map 窓で押したキーも KEY_EVENT で届き、ここでまとめて処理する
  const tabsRef = useRef<Tab[]>([]);
  tabsRef.current = tabs;
  const mover = useRef<MoveRepeat | null>(null);
  useEffect(() => {
    if (active === null) {
      mover.current = null;
      return;
    }
    const session = active;
    mover.current = new MoveRepeat(
      (text) => sendLine(session, text),
      () => keyContext(mapStates.current.get(session), true).northFix,
      undefined,
      { startMs: settings.repeatStartMs, endMs: settings.repeatEndMs },
    );
    const timer = setInterval(() => mover.current?.tick(), 50);
    return () => clearInterval(timer);
  }, [active, settings.repeatStartMs, settings.repeatEndMs]);

  useEffect(() => {
    const focusInput = () => {
      getCurrentWindow().setFocus();
      document.querySelector<HTMLTextAreaElement>(".input-line")?.focus();
    };
    const nextTab = () => {
      const ts = tabsRef.current;
      if (ts.length === 0) return;
      const i = ts.findIndex((t) => t.session === activeRef.current);
      setActive(ts[(i + 1) % ts.length].session);
    };
    // マップ窓の表示・非表示(Philly の Shift+F5 DispMap)
    const toggleMap = () =>
      Window.getByLabel("map").then(async (w) => {
        if (!w) return;
        if (await w.isVisible()) await w.hide();
        else {
          await w.show();
          sendMapState(activeRef.current);
        }
      });
    /** 操作にしたら true */
    const onKey = (e: ForwardedKey): boolean => {
      const session = activeRef.current;
      if (session === null) return false;
      if (e.type === "blur") {
        mover.current?.releaseAll();
        return false;
      }
      const ctx = keyContext(mapStates.current.get(session), settingsRef.current.fullKeyMove);
      // リスト表示中は、番号・取り消し・カーソルのキーを移動より先に見る(Philly の KeyDown は KeyBindListMode が先)。
      // フルキー移動の 7・8・9 やテンキーの 2・4・6・8、上下の矢印は、リスト表示中は番号とカーソルになる
      const list = tabsRef.current.find((t) => t.session === session)?.list;
      const listAction = list && e.type === "keydown" ? listKeyAction(e, ctx) : null;
      if (list && listAction) {
        if (e.repeat && !("listCursor" in listAction) && !("listToggle" in listAction)) return true;
        if ("listNo" in listAction) {
          const r = listNo(list, listAction.listNo);
          if (r && "ok" in r) closeListAndSend(session, listOk(list));
          else if (r?.close) closeListAndSend(session, r.send);
          else if (r) sendLine(session, r.send);
        } else if ("send" in listAction) closeListAndSend(session, listAction.send);
        else if ("listOk" in listAction) closeListAndSend(session, listOk(list));
        else if ("focusInput" in listAction) focusInput();
        else updateList(session, (l) => moveListCursor(l, listAction));
        return true;
      }
      const move = moveInput(e, ctx);
      if (move) {
        if (e.type === "keydown") mover.current?.keyDown(move.key, move.mods, e.repeat);
        else mover.current?.keyUp(move.key);
        return true;
      }
      if (e.type !== "keydown") return false;
      // F8〜F12 と Alt+G(設定で決まる文字列)
      const shortcut = shortcutText(e, settingsRef.current, !!list);
      if (shortcut !== null) {
        if (!e.repeat) sendLines(session, shortcut);
        return true;
      }
      const action = keyAction(e, ctx);
      if (!action) return false;
      // 押し続けによる自動リピートは送らない
      const openBoard = () => update(session, (t) => ({ ...t, board: true }));
      const cancelList = (n: number) => (listFlow(session).cancel += n);
      if (!e.repeat) runKeyAction(action, session, { focusInput, nextTab, openBoard, toggleMap, cancelList, ask });
      return true;
    };
    const onDom = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing || isTextTarget(e)) {
        // 入力欄へ移った後に離したキーで、移動キーが押されたままにならないようにする
        if (e.type === "keyup") onKey({ ...pick(e), type: "keyup" });
        return;
      }
      if (onKey({ ...pick(e), type: e.type as "keydown" | "keyup" })) e.preventDefault();
    };
    const onBlur = () => mover.current?.releaseAll();
    document.addEventListener("keydown", onDom);
    document.addEventListener("keyup", onDom);
    window.addEventListener("blur", onBlur);
    const forwarded = listen<ForwardedKey>(KEY_EVENT, (e) => onKey(e.payload));
    // リスト表示中に何かを送ったら、続きのページの番号(ずれ+9)でない限りリストを閉じる(Philly の SendTextListCancel)。
    // v5y は「番号ではありません」でリストを取り消しても、リストの終わりを送ってこない
    const onSent = (e: Event) => {
      const { session, text } = (e as CustomEvent<{ session: number; text: string }>).detail;
      const list = tabsRef.current.find((t) => t.session === session)?.list;
      if (!list || text.trim() === moreNo(list)) return;
      update(session, (t) => ({ ...t, list: null }));
      onMapEvent(session, { type: "list", active: false });
    };
    window.addEventListener(SENT_EVENT, onSent);
    // メニューバー(src-tauri/src/menu.rs)
    const menu = listen<string>("phi-menu", (e) => {
      const id = e.payload;
      const session = activeRef.current;
      if (id === "settings") return setSettingsOpen(true);
      if (session === null) return;
      if (id === "priv") return update(session, (t) => ({ ...t, privOpen: !t.privOpen }));
      if (id === "automap-clear") return clearAutomap(mapStates.current.get(session)?.world);
      const action = menuAction(id);
      const openBoard = () => update(session, (t) => ({ ...t, board: true }));
      const cancelList = (n: number) => (listFlow(session).cancel += n);
      if (action) runKeyAction(action, session, { focusInput, nextTab, openBoard, toggleMap, cancelList, ask });
    });
    // マップのマウス操作(Philly の MapForm.cpp の FormMouseDown)
    const mouse = listen<ForwardedMouse>(MOUSE_EVENT, (e) => {
      const m = e.payload;
      const session = activeRef.current;
      if (session === null) return;
      if (m.type === "hit") sendLine(session, "hit");
      else if (m.type === "down") mover.current?.mouseDown(m.keys);
      else if (m.type === "move") mover.current?.mouseMove(m.keys);
      else mover.current?.mouseUp();
    });
    // map 窓のリストのクリック(#9)
    const mapList = listen<MapListAction>(MAP_LIST_EVENT, (e) => {
      const session = activeRef.current;
      const list = tabsRef.current.find((t) => t.session === session)?.list;
      if (session === null || !list) return;
      const a = e.payload;
      if (a.type === "toggle")
        updateList(session, (l) => ({ ...l, checked: l.checked.map((c, i) => (i === a.index ? !c : c)) }));
      else closeListAndSend(session, listOk(a.type === "pick" ? { ...list, checked: [], cursor: a.index } : list));
    });
    return () => {
      document.removeEventListener("keydown", onDom);
      document.removeEventListener("keyup", onDom);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener(SENT_EVENT, onSent);
      forwarded.then((f) => f());
      mouse.then((f) => f());
      mapList.then((f) => f());
      menu.then((f) => f());
    };
  }, []);

  // 拡張マップの記録(世界名 → 地形)。変わったマスは map 窓へ送り、localStorage へは5秒ごとにまとめて書く
  const automaps = useRef(new Map<string, Tiles>());
  const unsavedWorlds = useRef(new Set<string>());
  const saveTimer = useRef<number | undefined>(undefined);
  function flushAutomaps() {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    for (const w of unsavedWorlds.current) saveTiles(w, automaps.current.get(w)!);
    unsavedWorlds.current.clear();
  }
  /** その世界の貯めた地形を消す(#15) */
  function clearAutomap(world: string | undefined) {
    if (!world || !window.confirm(`${world} の拡張マップを消します。\nよろしいですか？`)) return;
    automaps.current.set(world, {});
    unsavedWorlds.current.delete(world);
    removeTiles(world);
    emitTo("map", AUTOMAP_EVENT, { world, diff: {}, clear: true } satisfies AutomapDiff).catch(console.error);
  }
  function recordAutomap(world: string, ev: Extract<UiEvent, { type: "map" }>) {
    let tiles = automaps.current.get(world);
    if (!tiles) automaps.current.set(world, (tiles = loadTiles(world)));
    const diff = absorb(tiles, ev);
    if (!diff) return;
    Object.assign(tiles, diff);
    emitTo("map", AUTOMAP_EVENT, { world, diff } satisfies AutomapDiff).catch(console.error);
    unsavedWorlds.current.add(world);
    // ponytail: 落ちると最大5秒分の地形を失う。困るなら間隔を縮める
    saveTimer.current ??= window.setTimeout(flushAutomaps, 5000);
  }

  function onMapEvent(session: number, ev: UiEvent) {
    const s = mapStates.current.get(session) ?? { session, mapset: "" };
    switch (ev.type) {
      case "map":
        s.map = ev;
        // 拡張マップ。世界ごとに見えた地形を貯める。盲目中は視界が霧で埋まるので貯めない
        if (s.world && s.world !== "???" && !s.cond?.blind) recordAutomap(s.world, ev);
        if (session === activeRef.current) mover.current?.onMap();
        break;
      case "status": {
        // 裏のタブで HP か MP が減ったら、タブに印を付ける
        const old = s.status;
        const down = (a?: number, b?: number) => a !== undefined && b !== undefined && b < a;
        if (session !== activeRef.current && old && (down(old.hp, ev.hp) || down(old.mp, ev.mp)))
          update(session, (t) => (t.hurt ? t : { ...t, hurt: true }));
        s.status = ev;
        break;
      }
      case "cond":
        s.cond = ev;
        break;
      case "mode":
        s.mode = ev;
        break;
      case "list":
        s.list = ev.active ? (ev.lines ?? []) : undefined;
        s.listChecked = undefined;
        break;
      case "worldMoved":
        // 移動先から #ex-notice が届くまで(Philly の RewriteSaveData)
        s.world = s.area = "???";
        break;
      case "notice":
        if (ev.mapset !== undefined) s.mapset = ev.mapset;
        else if (ev.world !== undefined) s.world = ev.world;
        else if (ev.area !== undefined) s.area = ev.area;
        else return;
        break;
      default:
        return;
    }
    mapStates.current.set(session, s);
    if (session === activeRef.current) sendMapState(session);
  }

  const listFlows = useRef(new Map<number, ListFlow>());
  const listFlow = (session: number): ListFlow => {
    let f = listFlows.current.get(session);
    if (!f) listFlows.current.set(session, (f = { cancel: 0, started: false }));
    return f;
  };

  const update = (session: number, f: (t: Tab) => Tab) =>
    setTabs((ts) => ts.map((t) => (t.session === session ? f(t) : t)));

  // チェックは map 窓のリストにも出す
  const updateList = (session: number, f: (l: ListState) => ListState) =>
    update(session, (t) => {
      if (!t.list) return t;
      const list = f(t.list);
      const s = mapStates.current.get(session);
      if (s && s.listChecked !== list.checked) {
        s.listChecked = list.checked;
        if (session === activeRef.current) sendMapState(session);
      }
      return { ...t, list };
    });

  /**
   * 発言と priv が届いた時の知らせ(Philly.ini の [TaskBarFlash])。
   * 裏のタブには未読の印を付け、窓が前に無ければタスクバーを点滅させる。
   * Philly の既定は GtOnly=on(> のある行だけ)、Loud=off(大声では点滅しない)
   */
  function notifyTalk(session: number, channel: string, html: string, noFlash: boolean) {
    if (channel !== "talk" && channel !== "priv") return;
    const loud = /^(?:<[^>]*>)*\(/.test(html);
    if (session !== activeRef.current) update(session, (t) => (t.unread ? t : { ...t, unread: true }));
    // DM の発言などは点滅させない(Philly の NotFlashRegexp.ini。Rust 側で照合する)
    if (!loud && !noFlash && !document.hasFocus())
      getCurrentWindow().requestUserAttention(UserAttentionType.Informational).catch(console.error);
  }

  /** 受けた priv を相手の組の会話に足す。会話が無ければ作り、priv の画面を開く(Philly.ini の PopupPrivForm) */
  function addPriv(session: number, from: string, html: string) {
    update(session, (t) => {
      const to = privPartners(from, html, t.self);
      if (to.length === 0) return t;
      const key = partnersKey(to);
      const line = timePrefix() + html;
      const exists = t.privs.some((c) => partnersKey(c.to) === key);
      const privs = exists
        ? t.privs.map((c) =>
            partnersKey(c.to) === key ? { ...c, lines: pushLine(c.lines, line), unread: t.privActive !== key } : c,
          )
        : [...t.privs, { to, lines: pushLine([], line), unread: true }];
      const active = t.privActive ?? key;
      return { ...t, privs: capConvs(privs, active), privOpen: true, privActive: active };
    });
  }

  // #ulist はセッションごとに 10 秒に1回まで(PrivForm.cpp の RequestUlistWait)。
  // 送ったら #user の行が届き終わるまで待ってから then を呼ぶ(最大 60 秒)。v5y は一覧の終わりを送らないので、
  // 最後の #user から ULIST_QUIET_MS 何も届かなければ終わった事にする
  const lastUlist = useRef(new Map<number, number>());
  const ulistWaits = useRef(new Map<number, { thens: (() => void)[]; timer: number }>());
  function requestUlist(session: number, then?: () => void) {
    const wait = ulistWaits.current.get(session);
    if (wait) {
      if (then) wait.thens.push(then);
      return;
    }
    const now = performance.now();
    if (now - (lastUlist.current.get(session) ?? -Infinity) < 10_000) {
      then?.();
      return;
    }
    lastUlist.current.set(session, now);
    ulistWaits.current.set(session, { thens: then ? [then] : [], timer: window.setTimeout(() => ulistDone(session), 60_000) });
    sendLine(session, "#ulist");
  }
  function ulistDone(session: number) {
    const wait = ulistWaits.current.get(session);
    if (!wait) return;
    window.clearTimeout(wait.timer);
    ulistWaits.current.delete(session);
    wait.thens.forEach((f) => f());
  }
  /** #user が届いた。待っていれば、少し待って届き終わった事にする */
  function ulistArrived(session: number) {
    const wait = ulistWaits.current.get(session);
    if (!wait) return;
    window.clearTimeout(wait.timer);
    wait.timer = window.setTimeout(() => ulistDone(session), ULIST_QUIET_MS);
  }

  /** priv を送る。先に #ulist で番号を取り直す(Philly の PrivForm.cpp の SendPrivMessage) */
  function sendPriv(session: number, to: string[], text: string) {
    requestUlist(session, () => {
      const t = tabsRef.current.find((t) => t.session === session);
      if (!t) return;
      const { lines, failed } = privLines(to, text, t.users, t.self);
      lines.forEach((l) => sendLine(session, l));
      for (const name of failed) append(session, systemNg(`「${name}」さんに送信できませんでした。`));
    });
  }

  /** リストで選んだ時と取り消した時。v5y は #ex-list-mode-end を送らないので、送った時点でリストを閉じる */
  function closeListAndSend(session: number, text: string) {
    sendLine(session, text);
    update(session, (t) => ({ ...t, list: null }));
    onMapEvent(session, { type: "list", active: false });
  }

  const append = (session: number, html: string) => {
    const line = timePrefix() + html;
    update(session, (t) => ({ ...t, lines: pushLine(t.lines, line) }));
    const tab = tabsRef.current.find((t) => t.session === session);
    if (tab?.logSave) saveLog(tab.label, line, settingsRef.current.logSaveHtml);
  };

  async function connect(label: string) {
    const channel = new Channel<UiEvent>();
    let session: number;
    try {
      session = await invoke<number>("connect", { label, onEvent: channel });
    } catch (e) {
      setError(`${label}: ${e}`);
      return;
    }
    channel.onmessage = (ev) => {
      switch (ev.type) {
        case "log":
          append(session, ev.html);
          notifyTalk(session, ev.channel, ev.html, !!ev.noFlash);
          if (ev.channel === "priv" && ev.from) addPriv(session, ev.from, ev.html);
          // リピート移動中に壁に当たった時(Philly の PersonalThread.cpp の RecvCannotGo)
          if (session === activeRef.current && /DM<\/font> &gt; (進めません\.|Can not go\.)/.test(ev.html))
            mover.current?.onCannotGo();
          break;
        case "error":
          append(session, systemNg(ev.message));
          break;
        case "sound":
          // Philly の SoundPlay。ファイルの無い規則はタスクバーの点滅
          if (!settingsRef.current.soundPlay) break;
          if (ev.file) new Audio(assetUrl("sound", { no: String(ev.no) })).play().catch(console.error);
          else getCurrentWindow().requestUserAttention(UserAttentionType.Informational).catch(console.error);
          break;
        case "connection":
          update(session, (t) => ({ ...t, closed: true }));
          break;
        case "userList":
          update(session, (t) => ({ ...t, users: usersFromEvent(ev.users) }));
          ulistArrived(session);
          break;
        case "notice":
          if (ev.name) {
            const name = ev.name;
            update(session, (t) => ({ ...t, self: name }));
          }
          onMapEvent(session, ev);
          break;
        case "eagleEye": {
          // EagleEye 窓に送って表示する(Philly の classEagleEye::Draw の ShowWindow)。アクティブなタブの分だけ
          if (session !== activeRef.current) break;
          const mapset = ev.mapset ?? mapStates.current.get(session)?.mapset;
          emitTo("eagleeye", EAGLE_EYE_EVENT, { ...ev, mapset }).catch(console.error);
          Window.getByLabel("eagleeye").then((w) => w?.show());
          break;
        }
        case "edit":
          // #m-edit で看板エディタを開き、#. で閉じる。#s-edit は Philly も何もしない(入力欄で答える)
          if (ev.mode === "multi") update(session, (t) => ({ ...t, board: true }));
          else if (ev.mode === "end") update(session, (t) => ({ ...t, board: false }));
          break;
        case "list": {
          // #list と #end-list はどちらも active で届くので、交互に来る事で見分ける。
          // #end-list の時、空のリストと、NextListCancel の印がある分は出さない(Philly の RecvListEnd)
          const flow = listFlow(session);
          if (!ev.active) {
            flow.started = false;
            update(session, (t) => ({ ...t, list: null }));
            onMapEvent(session, ev);
            break;
          }
          if (!flow.started) {
            flow.started = true;
            break;
          }
          flow.started = false;
          const lines = ev.lines ?? [];
          const cancel = flow.cancel > 0;
          if (cancel) flow.cancel--;
          if (lines.length === 0 || cancel) break;
          update(session, (t) => ({ ...t, list: newList(lines) }));
          onMapEvent(session, ev);
          break;
        }
        default:
          onMapEvent(session, ev);
      }
    };
    setTabs((ts) => [
      ...ts,
      {
        session,
        label,
        lines: [],
        closed: false,
        list: null,
        board: false,
        self: "",
        users: [],
        privs: [],
        privOpen: false,
        privActive: null,
        logSave: false,
        unread: false,
        hurt: false,
      },
    ]);
    setActive(session);
  }

  function close(session: number) {
    invoke("disconnect", { session }).catch((e) => console.error(e));
    setTabs((ts) => ts.filter((t) => t.session !== session));
    mapStates.current.delete(session);
    setActive(null);
  }

  const tab = tabs.find((t) => t.session === active);

  return (
    <div className="main">
      {asking && (
        <AskDialog
          opts={asking.opts}
          onAnswer={(text) => {
            asking.resolve(text);
            setAsking(null);
          }}
        />
      )}
      {settingsOpen && (
        <SettingsPanel settings={settings} onSaved={setSettings} onClose={() => setSettingsOpen(false)} />
      )}
      <style>{logCss}</style>
      <TabBar tabs={tabs} active={active} onSelect={setActive} onClose={close} onSettings={() => setSettingsOpen(true)} />
      {tab ? (
        <div className="main-body">
        <div className="log-area">
          <LogView key={tab.session} lines={tab.lines} follow={logFollow} />
          {tab.board && (
            <BoardEditor
              name={tab.label}
              onSend={(text) => {
                sendLines(tab.session, text);
                update(tab.session, (t) => ({ ...t, board: false }));
              }}
              onCancel={() => {
                // 閉じる時は .! を送って書くのをやめる(MEditForm.cpp の FormClose)
                sendLine(tab.session, ".!");
                update(tab.session, (t) => ({ ...t, board: false }));
              }}
            />
          )}
          {tab.list && (
            <ListOverlay
              list={tab.list}
              onChange={(l) => updateList(tab.session, () => l)}
              onSend={(text) => closeListAndSend(tab.session, text)}
              onMore={(text) => sendLine(tab.session, text)}
            />
          )}
        </div>
        {tab.privOpen && (
          <PrivPanel
            convs={tab.privs}
            active={tab.privActive}
            users={tab.users}
            self={tab.self}
            onSelect={(key) =>
              update(tab.session, (t) => ({
                ...t,
                privActive: key,
                privs: t.privs.map((c) => (partnersKey(c.to) === key ? { ...c, unread: false } : c)),
              }))
            }
            onOpen={(to) =>
              update(tab.session, (t) => {
                const key = partnersKey(to);
                const privs = t.privs.some((c) => partnersKey(c.to) === key)
                  ? t.privs
                  : [...t.privs, { to: [...to].sort(), lines: [], unread: false }];
                return { ...t, privs, privActive: key };
              })
            }
            onSend={(to, text) => sendPriv(tab.session, to, text)}
            onClose={() => update(tab.session, (t) => ({ ...t, privOpen: false }))}
          />
        )}
        </div>
      ) : (
        <CharacterList
          store={store}
          error={error}
          onConnect={(label) => {
            setError("");
            connect(label);
          }}
          onChanged={() => {
            setError("");
            reload();
          }}
          onError={setError}
        />
      )}
      {tab && (
        <InputEditor
          logFollow={logFollow}
          onLogFollow={setLogFollow}
          logSave={tab.logSave}
          onLogSave={(on) => {
            update(tab.session, (t) => ({ ...t, logSave: on }));
            if (on)
              saveLog(tab.label, timePrefix() + "ログの保存を始めました", settings.logSaveHtml)
                .then((path) => path && append(tab.session, systemOk(`ログを ${path} に保存します`)))
                .catch(console.error);
          }}
          onOpenLogDir={() => invoke("open_log_dir", { label: tab.label }).catch((e) => append(tab.session, systemNg(String(e))))}
          onPriv={() => {
            requestUlist(tab.session);
            update(tab.session, (t) => ({ ...t, privOpen: !t.privOpen }));
          }}
          session={tab.session}
          sessions={tabs.filter((t) => !t.closed).map((t) => t.session)}
          disabled={tab.closed}
        />
      )}
      <div className="status-bar">{tab ? (tab.closed ? "切断" : "接続中") : "キャラ選択"}</div>
    </div>
  );
}

function moveListCursor(l: ListState, a: { listCursor: -1 | 1 } | { listToggle: true }): ListState {
  const last = Math.max(l.lines.length - 1, 0);
  if ("listCursor" in a) return { ...l, cursor: Math.min(Math.max(l.cursor + a.listCursor, 0), last) };
  const checked = l.checked.map((c, i) => (i === l.cursor ? !c : c));
  return { ...l, checked, cursor: Math.min(l.cursor + 1, last) };
}

function pick(e: globalThis.KeyboardEvent) {
  const { code, shiftKey, ctrlKey, altKey, metaKey, repeat } = e;
  return { code, shiftKey, ctrlKey, altKey, metaKey, repeat };
}

function TabBar(props: {
  tabs: Tab[];
  active: number | null;
  onSelect: (s: number | null) => void;
  onClose: (s: number) => void;
  onSettings: () => void;
}) {
  return (
    <div className="tab-bar">
      {props.tabs.map((t) => (
        <span
          key={t.session}
          className={t.session === props.active ? "tab active" : t.unread ? "tab unread" : "tab"}
        >
          <button className="tab-label" onClick={() => props.onSelect(t.session)}>
            {t.session !== props.active && t.hurt && (
              <span className="tab-hurt" title="HP か MP が減りました">
                ♥
              </span>
            )}
            {t.label}
          </button>
          <button className="tab-close" title="切断して閉じる" onClick={() => props.onClose(t.session)}>
            ×
          </button>
        </span>
      ))}
      <button className="tab" onClick={() => props.onSelect(null)}>
        ＋
      </button>
      <button className="tab tab-settings" onClick={props.onSettings}>
        設定
      </button>
    </div>
  );
}

/**
 * ログ欄。follow が on の時は、ログが増えるたびと、中の画像が読み込まれて高さが変わるたびに最下行へ移る。
 * off は Philly の「ログスクロール停止」に当たる
 */
function LogView(props: { lines: LogLine[]; follow: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const follow = useRef(props.follow);
  follow.current = props.follow;

  const toBottom = () => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  };
  useEffect(toBottom, [props.lines, props.follow]);
  useEffect(() => {
    if (!inner.current) return;
    const ro = new ResizeObserver(toBottom);
    ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="phi-log"
      // フォーカスを受けると「移動モード」になり、キーが操作になる
      tabIndex={0}
    >
      <div ref={inner}>
        <LogLines lines={props.lines} />
      </div>
    </div>
  );
}

/**
 * 入力欄(Philly の InputEdit)。Philly と同じ複数行のエディタで、Enter はカーソルの行を送り、送った行は欄に残す。
 * Ctrl+Enter はパーティー発言、Shift+Enter は改行。
 * value を React に持たせない。ログが届くたびの再描画で value を書き戻すと、WebKitGTK が変換中の文字を消す
 */
function InputEditor(props: {
  session: number;
  sessions: number[];
  disabled: boolean;
  onPriv: () => void;
  logSave: boolean;
  onLogSave: (on: boolean) => void;
  onOpenLogDir: () => void;
  logFollow: boolean;
  onLogFollow: (on: boolean) => void;
}) {
  const [loud, setLoud] = useState(false);
  // 確認で「すべて大声」を選んだ。大声を解除するまで確認せず、送っても大声のままにする(Philly の大声の確認)
  const [loudAll, setLoudAll] = useState(false);
  // 大声の確認で答えを待っている発言
  const [loudAsk, setLoudAsk] = useState<{ deliver: () => void; ta: HTMLTextAreaElement } | null>(null);
  const [allTab, setAllTab] = useState(false);
  // 連続送信を 100ms 空ける(Philly の SendFromInputEdit)
  const lastSend = useRef(0);

  function send(ta: HTMLTextAreaElement, ctrl: boolean) {
    const now = performance.now();
    if (now - lastSend.current < 100) return;
    lastSend.current = now;
    const line = caretLine(ta.value, ta.selectionStart);
    const text = prepareLine(line.text, { ctrl, loud: loud && !allTab, lastLine: line.index + 1 >= line.count });
    if (text === null) return;
    const deliver = () => {
      if (allTab) {
        if (!window.confirm("全タブに発言します。\nよろしいですか？")) {
          setAllTab(false);
          return;
        }
        props.sessions.forEach((s) => sendLine(s, text));
      } else sendLine(props.session, text);
      const next = afterSend(ta.value, ta.selectionStart);
      ta.value = next.value;
      ta.setSelectionRange(next.caret, next.caret);
      // 送った行が見えるよう、カーソルの位置までスクロールする
      ta.blur();
      ta.focus();
    };
    // Philly は大声の前に確認し、送ったら大声を解除する。「すべて大声」の後は確認しない
    if (loud && !allTab && !loudAll) {
      setLoudAsk({ deliver, ta });
      return;
    }
    deliver();
  }

  function answerLoud(answer: "yes" | "all" | "no") {
    const ask = loudAsk;
    setLoudAsk(null);
    if (!ask) return;
    if (answer === "all") setLoudAll(true);
    else setLoud(false);
    if (answer === "no") ask.ta.focus();
    else ask.deliver();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Esc でログ欄へ移り、キーを操作に使う(Philly の移動モード)
    if (e.key === "Escape" && !e.nativeEvent.isComposing) {
      document.querySelector<HTMLElement>(".phi-log")?.focus();
      return;
    }
    // IME の変換確定の Enter では送らない。WebKit は確定の keydown で isComposing を false にし、keyCode 229 を返す
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229 || e.shiftKey || e.altKey) return;
    e.preventDefault();
    send(e.currentTarget, e.ctrlKey);
  }

  return (
    <div className="input-area">
      {loudAsk && (
        <div
          className="confirm-dialog"
          role="dialog"
          // キーを Philly の操作にしない。Esc は「いいえ」
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") answerLoud("no");
          }}
        >
          <p>
            大声で発言します。
            <br />
            この世界にいる全員に聞こえます。
            <br />
            よろしいですか？
          </p>
          <div className="confirm-buttons">
            <button autoFocus onClick={() => answerLoud("yes")}>
              はい
            </button>
            <button onClick={() => answerLoud("all")}>すべて大声</button>
            <button onClick={() => answerLoud("no")}>いいえ</button>
          </div>
        </div>
      )}
      <div className="input-toolbar">
        <label className={loud ? "toggle on" : "toggle"}>
          <input
            type="checkbox"
            checked={loud}
            onChange={(e) => {
              setLoud(e.target.checked);
              if (!e.target.checked) setLoudAll(false);
            }}
          />
          {loudAll ? "すべて大声" : "大声"}
        </label>
        <label className={allTab ? "toggle on" : "toggle"}>
          <input type="checkbox" checked={allTab} onChange={(e) => setAllTab(e.target.checked)} />
          全タブ発言
        </label>
        <label className={props.logFollow ? "toggle on" : "toggle"} title="ログが増えたら最下行へ移る">
          <input type="checkbox" checked={props.logFollow} onChange={(e) => props.onLogFollow(e.target.checked)} />
          ログを固定
        </label>
        <label className={props.logSave ? "toggle on" : "toggle"}>
          <input type="checkbox" checked={props.logSave} onChange={(e) => props.onLogSave(e.target.checked)} />
          ログ保存
        </label>
        <button className="toggle" title="ログの保存先のフォルダを開く" onClick={props.onOpenLogDir}>
          保存先
        </button>
        <button className="toggle" onClick={props.onPriv}>
          priv
        </button>
      </div>
      <textarea
        className={loud ? "input-line loud" : "input-line"}
        disabled={props.disabled}
        onKeyDown={onKeyDown}
        rows={3}
        spellCheck={false}
        autoFocus
      />
    </div>
  );
}

function CharacterList(props: {
  store: Store;
  error: string;
  onConnect: (label: string) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [id, setId] = useState("");
  const [folder, setFolder] = useState("");
  const [imported, setImported] = useState("");

  const run = (p: Promise<unknown>) => p.then(props.onChanged).catch((e) => props.onError(String(e)));

  return (
    <div className="character-list">
      {props.error && <p className="error">{props.error}</p>}
      <table>
        <tbody>
          {props.store.characters.map((c) => (
            <tr key={c.label}>
              <td>{c.label}</td>
              <td>
                {c.host}:{c.port}
              </td>
              <td>
                <button onClick={() => props.onConnect(c.label)}>接続</button>
                <button onClick={() => run(invoke("delete_character", { label: c.label }))}>削除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(invoke("save_character", { character: { label, host, port: Number(port) }, id }));
          setId("");
        }}
      >
        <h3>キャラを登録</h3>
        <label>
          表示名 <input value={label} onChange={(e) => setLabel(e.target.value)} required />
        </label>
        <label>
          サーバ <input value={host} onChange={(e) => setHost(e.target.value)} required />
        </label>
        <label>
          ポート <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" required />
        </label>
        <label>
          キャラ ID(登録済みの表示名なら空欄で接続先だけ変える)
          <input type="password" value={id} onChange={(e) => setId(e.target.value)} />
        </label>
        <button type="submit">登録</button>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          invoke<string[]>("import_philly", { folder })
            .then((labels) => {
              setImported(labels.length ? `${labels.join("、")} を取り込みました` : "キャラが見つかりません");
              props.onChanged();
            })
            .catch((err) => props.onError(String(err)));
        }}
      >
        <h3>Philly から取り込む</h3>
        <label>
          Philly フォルダ(<code>*.chara</code> のあるフォルダ)
          <input value={folder} onChange={(e) => setFolder(e.target.value)} required />
        </label>
        <button type="submit">取り込む</button>
        {imported && <p>{imported}</p>}
      </form>

      <NewCharacter onCreated={props.onChanged} onError={props.onError} />
    </div>
  );
}
