import { Channel, invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { latestRelease } from "./update.ts";
import { isMac, MenuBar } from "./MenuBar";
import { MASTER_EXP, parseMasterMagic, runMasterItem, type MasterMenu } from "./masterMagic.ts";
import { afterSend, caretLine, prepareLine } from "./chat.ts";
import { SENT_EVENT, type Sent } from "./keyInput";
import { isTextTarget, KEY_EVENT, MOUSE_EVENT, type ForwardedMouse, keyContext, runKeyAction, sendLine, sendLines, type ForwardedKey } from "./keyInput";
import { keyAction, listKeyAction, menuAction, moveCommand, moveInput, type AskOptions } from "./keys.ts";
import { AskDialog } from "./AskDialog";
import { alertBox, confirmBox, MessageDialogHost } from "./MessageDialog";
import { TagMenu, type TagMenuAt } from "./TagMenuPopup";
import { assetUrl } from "./asset";
import { absorb, AUTOMAP_EVENT, blockOf, loadTiles, removeTiles, saveTiles, type AutomapDiff, type Tiles } from "./automap.ts";
import { BoardEditor } from "./BoardEditor";
import { DEFAULT_SETTINGS, EXPERIMENT_EVENT, shortcutText, type Settings } from "./settings.ts";
import { SettingsPanel } from "./SettingsPanel";
import { NewCharacter } from "./NewCharacter";
import { capConvs, partnersKey, privLines, privPartners, upsertConv, usersFromEvent, type User } from "./priv.ts";
import { PrivPanel, type PrivConv } from "./PrivPanel";
import { ListOverlay } from "./ListOverlay";
import { listNo, listOk, moreNo, moveListCursor, receiveList, type ListFlow, type ListState } from "./list.ts";
import { trace } from "./trace.ts";
import { PREDICT_TICK_MS, Predictor } from "./predict.ts";
import { EAGLE_EYE_EVENT, MAP_HIDDEN_EVENT, MAP_LIST_EVENT, MAP_STATE_EVENT, TRANSFER_NO, TRANSFER_YES, type MapListAction, type MapState, type UiEvent } from "./protocol";
import { Window } from "@tauri-apps/api/window";
import { LogLines } from "./LogLineList";
import { pushLine, pushLines, scopeLogCss, type LogLine } from "./logLines.ts";

// src-tauri/src/characters.rs の Store
type Character = { label: string; host: string; port: number };
type Store = { characters: Character[]; openTabs: string[] };

/** 入力欄のツールバーと同じ切り替えのメニュー項目(src-tauri/src/menu.rs の 操作)。App から InputEditor へ送る */
const INPUT_MENU = ["loud", "all-tab", "log-save", "log-follow", "open-log-dir"];
const INPUT_MENU_EVENT = "phi-input-menu";

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

/** ログを利用者の地域の日付のファイルに足す。保存先のパスを返す。
 * 1つ前の書き込みが終わってから書く。並行に書くと、行の順序が入れ替わり、ヘッダが二重になる(#65) */
let logQueue: Promise<unknown> = Promise.resolve();
function saveLog(label: string, line: string, asHtml: boolean): Promise<string | void> {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const p = logQueue.then(() =>
    invoke<string>("append_log", { label, date, html: line, asHtml }).catch((e) => console.error(e)),
  );
  logQueue = p;
  return p;
}

function systemNg(message: string): string {
  return `<font class="class_system_ng">${escapeHtml(message)}</font>`;
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
  const [asking, setAsking] = useState<{ id: number; opts: AskOptions; resolve: (text: string | null) => void } | null>(
    null,
  );
  // 開いている問いがあれば取り消してから出す。id を key にして、前の問いに打った文字を残さない(#63)
  const askId = useRef(0);
  const ask = (opts: AskOptions) =>
    new Promise<string | null>((resolve) =>
      setAsking((prev) => {
        prev?.resolve(null);
        return { id: ++askId.current, opts, resolve };
      }),
    );
  // ログを最下行に固定する(既定 on。off は Philly の「ログスクロール停止」)
  const [logFollow, setLogFollow] = useState(true);
  // 新しい版があれば、Release のページを開くか聞く(#25)。見られなくても何も出さない
  useEffect(() => {
    getVersion()
      .then(latestRelease)
      .then((r) => {
        if (r) return confirmBox(`新しい版 ${r.version} があります。\nダウンロードのページを開きますか？`).then(async (ok) => {
            if (ok) await openUrl(r.url);
          });
      })
      .catch(console.error);
  }, []);
  useEffect(() => {
    invoke<Settings>("get_settings").then(setSettings).catch(console.error);
    // 表示のメニューで切り替えた分を覚える。覚えないと、設定の画面で保存した時に元に戻す
    const smooth = listen<Settings>(EXPERIMENT_EVENT, (e) =>
      setSettings((s) => ({ ...s, smoothMove: e.payload.smoothMove, automap: e.payload.automap })),
    );
    return () => {
      smooth.then((f) => f());
    };
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
  // map 窓へは、続けて届いた分を次のタスクでまとめて送る。#m57 と #status がそれぞれ 0.2 秒ごとに届き、1つ届くたびに MapState 全体を送っていた。
  // setTimeout を使わない。map 窓にフォーカスがある間 main 窓は裏の窓になり、WebView2 がタイマーを 1 秒ごとに間引くと地図が止まって見える(#44)
  const mapStatePort = useRef<MessageChannel | null>(null);
  const pendingDiffs = useRef<AutomapDiff[]>([]);
  // 拡張マップの付属: 表のタブの位置の予想。返事を待ちきった移動を進んだとみなす
  const predictor = useRef(new Predictor());
  useEffect(() => {
    predictor.current.reset();
    if (!settings.automap || active === null) return;
    const timer = setInterval(() => {
      if (predictor.current.tick()) sendMapState(activeRef.current);
    }, PREDICT_TICK_MS);
    return () => {
      clearInterval(timer);
      predictor.current.reset();
      sendMapState(activeRef.current);
    };
  }, [active, settings.automap]);
  /** 移動を送る。位置を予想している時は数える */
  const sendMove = (session: number, text: string) => {
    if (settingsRef.current.automap && session === activeRef.current) predictor.current.sent(text);
    sendLine(session, text);
  };
  const mapStateQueued = useRef(false);
  const mapStateSession = useRef<number | null>(null);
  const mapShown = useRef(true);
  useEffect(() => {
    Window.getByLabel("map")
      .then((w) => w?.isVisible())
      .then((v) => (mapShown.current = v ?? false))
      .catch(console.error);
    const hidden = listen(MAP_HIDDEN_EVENT, () => (mapShown.current = false));
    return () => {
      hidden.then((f) => f());
    };
  }, []);
  const sendMapState = (session: number | null) => {
    mapStateSession.current = session;
    if (mapStateQueued.current) return;
    mapStateQueued.current = true;
    if (!mapStatePort.current) {
      mapStatePort.current = new MessageChannel();
      mapStatePort.current.port1.onmessage = () => {
        mapStateQueued.current = false;
        // 隠した map 窓には送らない。拡張マップの差分は貯めておき、表示した時にまとめて送る(#75)
        if (!mapShown.current) return;
        const s = mapStateSession.current;
        const state = s === null ? undefined : mapStates.current.get(s);
        const diffs = pendingDiffs.current.splice(0);
        const predict = predictor.current.offset;
        trace("main emit");
        emitTo("map", MAP_STATE_EVENT, { ...(state ?? { session: -1, mapset: "" }), diffs, predict }).catch((e) =>
          console.error(e),
        );
      };
    }
    mapStatePort.current.port2.postMessage(null);
  };
  useEffect(() => sendMapState(active), [active]);
  // メニューの表示のモード(回転か北固定か、7x7 か 5x5 か)に、今のタブのモードのチェックを付ける。
  // モードはサーバが決めるので、地図を受けるたびに見る。変わった時だけ Rust へ送る
  const viewChecks = useRef("");
  // 超魔法メニュー(#83)。表のタブのキャラがマスター(経験値 99999999)か、設定で出す時だけ出す
  const [masterMenu, setMasterMenu] = useState<MasterMenu | null>(null);
  const masterMenuRef = useRef<MasterMenu | null>(null);
  masterMenuRef.current = masterMenu;
  const [masterShown, setMasterShown] = useState(false);
  const masterShownRef = useRef(false);
  useEffect(() => {
    invoke<string | null>("master_magic_xml")
      .then((xml) => setMasterMenu(xml ? parseMasterMagic(xml) : null))
      .catch(console.error);
  }, []);
  // 受信の処理からも呼ぶので、状態は ref から読む
  const syncMasterMenu = () => {
    const menu = masterMenuRef.current;
    const s = activeRef.current === null ? undefined : mapStates.current.get(activeRef.current);
    const show = !!menu && activeRef.current !== null && (settingsRef.current.masterMagicMenu || s?.status?.exp === MASTER_EXP);
    if (show === masterShownRef.current) return;
    masterShownRef.current = show;
    setMasterShown(show);
    invoke("set_master_menu", {
      caption: menu?.caption ?? "",
      menus: show ? menu!.menus.map((m) => ({ caption: m.caption, items: m.items.map((it) => (it === "-" ? "-" : it.caption)) })) : null,
    }).catch(console.error);
  };
  useEffect(syncMasterMenu, [active, masterMenu, settings.masterMagicMenu]);
  const runMaster = (id: string, session: number) => {
    const [, i, j] = id.split(":").map(Number);
    const item = masterMenuRef.current?.menus[i]?.items[j];
    if (!item || item === "-") return;
    runMasterItem(item.steps, {
      send: (lines, cancel) => {
        if (cancel > 0) listFlow(session).cancel += cancel;
        sendLines(session, lines.join("\n"));
      },
      confirm: confirmBox,
      ask: (label, numeric) => ask({ title: item.caption, label, numeric }),
    }).catch(console.error);
  };
  // macOS の窓の中のメニューのチェック(MenuBar)。OS のメニューは set_view_checks で付ける
  const [viewMode, setViewMode] = useState<{ turn: boolean; size57: boolean } | null>(null);
  const menuChecked = (id: string): boolean =>
    ({
      "map-turn": viewMode?.turn,
      "map-solid": viewMode && !viewMode.turn,
      "map-57": viewMode?.size57,
      "map-40": viewMode && !viewMode.size57,
      "smooth-move": settings.smoothMove,
      automap: settings.automap,
    })[id] ?? false;
  const syncViewChecks = (force = false) => {
    const s = activeRef.current === null ? undefined : mapStates.current.get(activeRef.current);
    if (!s?.map) return;
    const turn = !keyContext(s, true).northFix;
    const size57 = s.map.size === 7;
    const key = `${turn},${size57}`;
    if (!force && key === viewChecks.current) return;
    viewChecks.current = key;
    setViewMode({ turn, size57 });
    invoke("set_view_checks", { turn, size57 }).catch(console.error);
  };
  useEffect(() => syncViewChecks(true), [active]);
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

  useEffect(() => {
    const focusInput = () => {
      getCurrentWindow().setFocus();
      document.querySelector<HTMLTextAreaElement>(".input-line")?.focus();
    };
    const nextTab = (step = 1) => {
      const ts = tabsRef.current;
      if (ts.length === 0) return;
      const i = ts.findIndex((t) => t.session === activeRef.current);
      setActive(ts[(i + step + ts.length) % ts.length].session);
    };
    const systemMagic = () => ({
      unequip: settingsRef.current.autoUnequipSystemMagic,
      equip: settingsRef.current.autoEquipSystemMagic,
    });
    // マップ窓の表示・非表示(Philly の Shift+F5 DispMap)
    const toggleMap = () =>
      Window.getByLabel("map").then(async (w) => {
        if (!w) return;
        if (await w.isVisible()) {
          mapShown.current = false;
          await w.hide();
        } else {
          await w.show();
          mapShown.current = true;
          sendMapState(activeRef.current);
        }
      });
    /** 操作にしたら true */
    const onKey = (e: ForwardedKey): boolean => {
      // 前のタブ(Ctrl+Shift+Tab)。keys.ts は Ctrl と Shift を一緒に押したキーを扱わないので、ここで見る
      if (e.type === "keydown" && e.code === "Tab" && e.ctrlKey && e.shiftKey && !e.altKey) {
        nextTab(-1);
        return true;
      }
      const session = activeRef.current;
      if (session === null) return false;
      const ctx = keyContext(mapStates.current.get(session), settingsRef.current.fullKeyMove);
      // リスト表示中は、番号・取り消し・カーソルのキーを移動より先に見る(Philly の KeyDown は KeyBindListMode が先)。
      // フルキー移動の 7・8・9 やテンキーの 2・4・6・8、上下の矢印は、リスト表示中は番号とカーソルになる
      const list = tabsRef.current.find((t) => t.session === session)?.list;
      const listAction = list && e.type === "keydown" ? listKeyAction(e, ctx) : null;
      if (list && listAction) {
        if (e.repeat && !("listCursor" in listAction) && !("listToggle" in listAction)) return true;
        if ("listNo" in listAction) {
          const r = listNo(list, listAction.listNo);
          if (r?.close) closeListAndSend(session, r.send);
          else if (r) sendLine(session, r.send);
        } else if ("send" in listAction) closeListAndSend(session, listAction.send);
        else if ("listOk" in listAction) closeListAndSend(session, listOk(list));
        else if ("focusInput" in listAction) focusInput();
        else updateList(session, (l) => moveListCursor(l, listAction));
        return true;
      }
      const move = moveInput(e, ctx);
      // 押し続けた時は OS のキーリピートに任せ、keydown のたびに1歩送る(Philly より前のクライアントと同じ)。
      // サーバは1ティックに1行ずつ処理するので、リピートが速いと離した後も少し歩く。
      // 拡張マップの時だけは Philly と同じく、リピートは前の移動の返事(地図・「進めません」・予想)を待つ。
      // 待たないと予想がサーバより何歩も先へ進み、まだ記録していない所(真っ暗)を描く
      if (move) {
        trace(`main ${e.type} ${e.code}${e.repeat ? " repeat" : ""}`);
        const blocked =
          e.repeat && settingsRef.current.automap && session === activeRef.current && predictor.current.waiting;
        if (e.type === "keydown" && !blocked) sendMove(session, moveCommand(move.key, move.mods, ctx.northFix));
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
      if (!e.repeat) runKeyAction(action, session, { focusInput, nextTab, openBoard, toggleMap, cancelList, ask, systemMagic });
      return true;
    };
    const onDom = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing || isTextTarget(e)) return;
      if (onKey({ ...pick(e), type: e.type as "keydown" | "keyup" })) e.preventDefault();
    };
    document.addEventListener("keydown", onDom);
    document.addEventListener("keyup", onDom);
    const forwarded = listen<ForwardedKey>(KEY_EVENT, (e) => onKey(e.payload));
    // リスト表示中に何かを送ったら、続きのページの番号(ずれ+9)でない限りリストを閉じる(Philly の SendTextListCancel)。
    // v5y は「番号ではありません」でリストを取り消しても、リストの終わりを送ってこない
    const onSent = ({ session, text }: Sent) => {
      const list = tabsRef.current.find((t) => t.session === session)?.list;
      if (!list || text.trim() === moreNo(list)) return;
      closeList(session);
    };
    const onSentDom = (e: Event) => onSent((e as CustomEvent<Sent>).detail);
    window.addEventListener(SENT_EVENT, onSentDom);
    const sentFromMap = listen<Sent>(SENT_EVENT, (e) => onSent(e.payload));
    // メニューバー(src-tauri/src/menu.rs)
    const menu = listen<string>("phi-menu", (e) => {
      const id = e.payload;
      const session = activeRef.current;
      if (id === "settings") return setSettingsOpen(true);
      if (id === "next-tab") return nextTab();
      if (id === "prev-tab") return nextTab(-1);
      // 登録したキャラ(#78)。タブがあればそのタブへ、無ければ接続する
      if (id.startsWith("char:")) {
        const label = id.slice("char:".length);
        const open = tabsRef.current.find((t) => t.label === label);
        return open ? setActive(open.session) : void connect(label);
      }
      // 接続・切断(#77)。全〜はタブ上の全キャラ
      const tabsNow = tabsRef.current;
      if (id === "all-connect") return tabsNow.filter((t) => t.closed).forEach((t) => connect(t.label, t.session));
      if (id === "all-disconnect")
        return tabsNow.filter((t) => !t.closed).forEach((t) => invoke("disconnect", { session: t.session }).catch(console.error));
      if (id === "all-force-close") return tabsNow.filter((t) => !t.closed).forEach((t) => forceClose(t.session));
      if (id === "new-tab") return setActive(null);
      if (id === "open-config-dir") return void invoke("open_config_dir").catch((e) => setError(String(e)));
      if (id === "trace")
        return void invoke<boolean>("trace_on")
          .then((v) => invoke<string | null>("set_trace", { on: !v }))
          .then((path) => alertBox(path ? `時刻の記録を始めました。\n${path}` : "時刻の記録を止めました。"))
          .catch((e) => setError(String(e)));
      if (id === "version") return void getVersion().then((v) => alertBox(`WPHI ${v}`));
      if (session === null) return;
      // 入力欄のツールバーと同じ切り替え。状態は InputEditor が持つ
      if (INPUT_MENU.includes(id)) return void window.dispatchEvent(new CustomEvent(INPUT_MENU_EVENT, { detail: id }));
      if (id === "priv") return togglePriv(session);
      const cur = tabsNow.find((t) => t.session === session);
      if (id === "connect") return cur?.closed ? void connect(cur.label, session) : undefined;
      if (id === "disconnect") return void invoke("disconnect", { session }).catch(console.error);
      if (id === "force-close") return cur?.closed ? undefined : forceClose(session);
      if (id === "close-tab") return close(session);
      if (id.startsWith("mm:")) return runMaster(id, session);
      if (id === "automap-clear") return clearAutomap(mapStates.current.get(session)?.world);
      // 選んだ項目はチェックが勝手に切り替わるので、今のモードに付け直す。サーバが切り替えたら地図を受けた時にまた付け直す
      if (["map-turn", "map-solid", "map-57", "map-40"].includes(id)) syncViewChecks(true);
      const action = menuAction(id);
      const openBoard = () => update(session, (t) => ({ ...t, board: true }));
      const cancelList = (n: number) => (listFlow(session).cancel += n);
      if (action) runKeyAction(action, session, { focusInput, nextTab, openBoard, toggleMap, cancelList, ask, systemMagic });
    });
    // マップのマウス操作(Philly の MapForm.cpp の FormMouseDown)
    const mouse = listen<ForwardedMouse>(MOUSE_EVENT, (e) => {
      const m = e.payload;
      const session = activeRef.current;
      if (session === null) return;
      if (m.type === "hit") sendLine(session, "hit");
      else {
        // 斜めは2方向を1歩ずつ送り、斜めに1マス進む(#76)
        const northFix = keyContext(mapStates.current.get(session), true).northFix;
        for (const k of m.keys) sendMove(session, moveCommand(k, "none", northFix));
      }
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
      window.removeEventListener(SENT_EVENT, onSentDom);
      sentFromMap.then((f) => f());
      forwarded.then((f) => f());
      mouse.then((f) => f());
      mapList.then((f) => f());
      menu.then((f) => f());
    };
  }, []);

  // 拡張マップの記録(世界名 → 地形)。変わったマスは map 窓へ送り、localStorage へは5秒ごとにまとめて書く
  const automaps = useRef(new Map<string, Tiles>());
  // 世界 → まだ書いていない区画
  const unsavedWorlds = useRef(new Map<string, Set<string>>());
  const saveTimer = useRef<number | undefined>(undefined);
  function flushAutomaps() {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    for (const [w, blocks] of unsavedWorlds.current) saveTiles(w, automaps.current.get(w)!, blocks);
    unsavedWorlds.current.clear();
  }
  /** その世界の貯めた地形を消す(#15) */
  async function clearAutomap(world: string | undefined) {
    if (!world || !(await confirmBox(`${world} の拡張マップを消します。\nよろしいですか？`))) return;
    automaps.current.set(world, {});
    unsavedWorlds.current.delete(world);
    pendingDiffs.current = pendingDiffs.current.filter((d) => d.world !== world);
    removeTiles(world);
    emitTo("map", AUTOMAP_EVENT, { world, diff: {}, clear: true } satisfies AutomapDiff).catch(console.error);
  }
  function recordAutomap(world: string, ev: Extract<UiEvent, { type: "map" }>) {
    let tiles = automaps.current.get(world);
    if (!tiles) automaps.current.set(world, (tiles = loadTiles(world)));
    const diff = absorb(tiles, ev);
    if (!diff) return;
    Object.assign(tiles, diff);
    pendingDiffs.current.push({ world, diff });
    let blocks = unsavedWorlds.current.get(world);
    if (!blocks) unsavedWorlds.current.set(world, (blocks = new Set()));
    for (const k of Object.keys(diff)) blocks.add(blockOf(k));
    // ponytail: 落ちると最大5秒分の地形を失う。困るなら間隔を縮める
    saveTimer.current ??= window.setTimeout(flushAutomaps, 5000);
  }

  function onMapEvent(session: number, ev: UiEvent) {
    const s = mapStates.current.get(session) ?? { session, mapset: "" };
    switch (ev.type) {
      case "map":
        s.map = ev;
        trace("main map");
        // 拡張マップ。世界ごとに見えた地形を貯める。盲目中は視界が霧で埋まるので貯めない
        if (s.world && s.world !== "???" && !s.cond?.blind) recordAutomap(s.world, ev);
        if (session === activeRef.current && ev.pos) predictor.current.onMap(`${ev.pos.x},${ev.pos.y}`);
        break;
      case "status": {
        // 裏のタブで HP か MP が減ったら、タブに印を付ける
        const old = s.status;
        const down = (a?: number, b?: number) => a !== undefined && b !== undefined && b < a;
        if (session !== activeRef.current && old && (down(old.hp, ev.hp) || down(old.mp, ev.mp)))
          update(session, (t) => (t.hurt ? t : { ...t, hurt: true }));
        s.status = ev;
        if (session === activeRef.current && old?.exp !== ev.exp) syncMasterMenu();
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
        else if (ev.mapsetDefine) {
          const defines = [...(s.defines ?? [])];
          defines[ev.mapsetDefine[0]] = ev.mapsetDefine[1];
          s.defines = defines;
        } else if (ev.world !== undefined) s.world = ev.world;
        else if (ev.area !== undefined) s.area = ev.area;
        else return;
        break;
      default:
        return;
    }
    mapStates.current.set(session, s);
    if (session === activeRef.current) {
      sendMapState(session);
      if (ev.type === "map") syncViewChecks();
    }
  }

  const listFlows = useRef(new Map<number, ListFlow>());
  const listFlow = (session: number): ListFlow => {
    let f = listFlows.current.get(session);
    if (!f) listFlows.current.set(session, (f = { cancel: 0, started: false }));
    return f;
  };

  // f が何も変えなければ元の配列を返し、App を描き直さない(#73)
  const update = (session: number, f: (t: Tab) => Tab) =>
    setTabs((ts) => {
      let changed = false;
      const next = ts.map((t) => {
        if (t.session !== session) return t;
        const n = f(t);
        if (n !== t) changed = true;
        return n;
      });
      return changed ? next : ts;
    });

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
    if (settingsRef.current.taskBarFlash && !loud && !noFlash && !document.hasFocus())
      getCurrentWindow().requestUserAttention(UserAttentionType.Informational).catch(console.error);
  }

  /** 受けた priv を相手の組の会話に足す。会話が無ければ作り、priv の画面を開く(Philly.ini の PopupPrivForm) */
  function addPriv(session: number, from: string, html: string) {
    // priv が届いて画面が開く時も、相手の一覧を取り直す
    if (!tabsRef.current.find((t) => t.session === session)?.privOpen) requestUlist(session);
    update(session, (t) => {
      const to = privPartners(from, html, t.self);
      if (to.length === 0) return t;
      const key = partnersKey(to);
      const line = shownTime(timePrefix()) + html;
      const privs = upsertConv(t.privs, to, (c) =>
        c
          ? { ...c, lines: pushLine(c.lines, line), unread: t.privActive !== key }
          : // 送り主は /*to=*/ で宛先を好きに足せるので、返信が知らない相手にも届く(Philly と同じ)。初めて送る前に確かめる(#53)
            { to, lines: pushLine([], line), unread: true, confirm: to.length > 1 },
      );
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

  /** priv の画面を開くか閉じる。開く時は相手の一覧を取り直す(メニューから開いた時も。取り直さないと一覧が空のまま) */
  function togglePriv(session: number) {
    if (!tabsRef.current.find((t) => t.session === session)?.privOpen) requestUlist(session);
    update(session, (t) => ({ ...t, privOpen: !t.privOpen }));
  }

  /** priv を送る。先に #ulist で番号を取り直す(Philly の PrivForm.cpp の SendPrivMessage) */
  async function sendPriv(session: number, to: string[], text: string): Promise<boolean> {
    const key = partnersKey(to);
    const conv = tabsRef.current.find((t) => t.session === session)?.privs.find((c) => partnersKey(c.to) === key);
    if (conv?.confirm) {
      const ok = await confirmBox(
        `この会話の宛先は、受けた priv に書かれていた名前から作りました。\n送り先: ${to.join("、")}\nこの全員に送りますか？`,
      );
      if (!ok) return false;
      update(session, (t) => ({
        ...t,
        privs: t.privs.map((c) => (partnersKey(c.to) === key ? { ...c, confirm: false } : c)),
      }));
    }
    requestUlist(session, () => {
      const t = tabsRef.current.find((t) => t.session === session);
      if (!t) return;
      const { lines, failed } = privLines(to, text, t.users, t.self);
      lines.forEach((l) => sendLine(session, l));
      for (const name of failed) append(session, systemNg(`「${name}」さんに送信できませんでした。`));
    });
    return true;
  }

  /** リストで選んだ時と取り消した時。v5y は #ex-list-mode-end を送らないので、送った時点でリストを閉じる */
  function closeListAndSend(session: number, text: string) {
    sendLine(session, text);
    closeList(session);
  }

  /** リストを閉じて map 窓に知らせる */
  function closeList(session: number) {
    update(session, (t) => ({ ...t, list: null }));
    onMapEvent(session, { type: "list", active: false });
  }

  // 続けて届いた行は次のタスクでまとめて足す。1行ごとに足すと、行の数だけ描き直しとレイアウトが走る(#73)
  const pendingLines = useRef(new Map<number, string[]>());
  const linesPort = useRef<MessageChannel | null>(null);
  /** 画面に出す時刻。時刻を出さない設定なら空(LogDispTime) */
  const shownTime = (time: string) => (settingsRef.current.logDispTime ? time : "");
  const append = (session: number, html: string) => {
    const time = timePrefix();
    const line = shownTime(time) + html;
    const tab = tabsRef.current.find((t) => t.session === session);
    // 保存するログには、時刻を出さない設定でも時刻を入れる(Philly の LogSaveTextWithTime=on)
    if (tab?.logSave) saveLog(tab.label, time + html, settingsRef.current.logSaveHtml);
    const queued = pendingLines.current.size > 0;
    const q = pendingLines.current.get(session);
    if (q) q.push(line);
    else pendingLines.current.set(session, [line]);
    if (queued) return;
    if (!linesPort.current) {
      linesPort.current = new MessageChannel();
      linesPort.current.port1.onmessage = () => {
        const all = pendingLines.current;
        pendingLines.current = new Map();
        setTabs((ts) => ts.map((t) => (all.has(t.session) ? { ...t, lines: pushLines(t.lines, all.get(t.session)!) } : t)));
      };
    }
    linesPort.current.port2.postMessage(null);
  };

  /**
   * 接続する。replace を渡すと、そのタブ(切れたタブ)で接続し直し、ログと priv はそのまま残す(Philly の 接続。#77)。
   * 渡さなければ新しいタブを開く
   */
  async function connect(label: string, replace?: number) {
    // connect が返る前に届いた分は貯めておき、タブを作ってから流す。Channel は onmessage の無い間に届いた分を捨てる(#70)
    const early: UiEvent[] = [];
    let handle: ((ev: UiEvent) => void) | null = null;
    const channel = new Channel<UiEvent>((ev) => (handle ? handle(ev) : early.push(ev)));
    let session: number;
    try {
      session = await invoke<number>("connect", { label, onEvent: channel });
    } catch (e) {
      setError(`${label}: ${e}`);
      return;
    }
    handle = (ev) => {
      switch (ev.type) {
        case "log":
          append(session, ev.html);
          notifyTalk(session, ev.channel, ev.html, !!ev.noFlash);
          if (ev.channel === "priv" && ev.from) addPriv(session, ev.from, ev.html);
          if (session === activeRef.current && /DM<\/font> &gt; (進めません\.|Can not go\.)/.test(ev.html))
            predictor.current.onCannotGo();
          break;
        case "error":
          append(session, systemNg(ev.message));
          break;
        case "confirmTransfer": {
          // 悪意のあるサーバが、任意のホストへキャラ ID を送らせない為(#51)
          confirmBox(
            `別のサーバ(${ev.host}:${ev.port})の世界へ移動します。\n移動先へキャラの ID を送ります。よろしいですか？`,
          )
            .then((ok) => invoke("send_line", { session, text: ok ? TRANSFER_YES : TRANSFER_NO }))
            .catch(console.error);
          break;
        }
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
          const r = receiveList(listFlow(session), ev.active, ev.lines);
          if (r === "close") closeList(session);
          else if (r) {
            update(session, (t) => ({ ...t, list: r }));
            onMapEvent(session, ev);
          }
          break;
        }
        default:
          onMapEvent(session, ev);
      }
    };
    if (replace !== undefined) {
      forgetSession(replace);
      setTabs((ts) =>
        ts.map((t) => (t.session === replace ? { ...t, session, closed: false, list: null, board: false, users: [] } : t)),
      );
      setActive((a) => (a === replace ? session : a));
      early.splice(0).forEach(handle);
      return;
    }
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
    early.splice(0).forEach(handle);
  }

  function close(session: number) {
    invoke("disconnect", { session }).catch((e) => console.error(e));
    setTabs((ts) => ts.filter((t) => t.session !== session));
    forgetSession(session);
    // 裏のタブを閉じた時は、表のタブをそのまま出す(#62)
    setActive((a) => (a === session ? null : a));
  }

  /** 強制切断(Philly の ForceClose)。#x を送らずに切る。切れた知らせは届かないので、ここで切断にする */
  function forceClose(session: number) {
    invoke("force_disconnect", { session }).catch(console.error);
    update(session, (t) => (t.closed ? t : { ...t, closed: true }));
    append(session, systemNg("強制切断しました"));
  }

  /** セッションごとに覚えた物を消す(#35) */
  function forgetSession(session: number) {
    mapStates.current.delete(session);
    listFlows.current.delete(session);
    lastUlist.current.delete(session);
    pendingLines.current.delete(session);
    const wait = ulistWaits.current.get(session);
    if (wait) window.clearTimeout(wait.timer);
    ulistWaits.current.delete(session);
  }

  const tab = tabs.find((t) => t.session === active);

  return (
    <div
      className={settings.logFontSize ? "main log-sized" : "main"}
      // ログ欄のフォントと大きさ(設定)。空と 0 はスキンと既定に任せる
      style={
        {
          "--log-font": settings.logFontName ? `"${settings.logFontName.replace(/["\\]/g, "")}", var(--ui-font)` : undefined,
          "--log-size": settings.logFontSize ? `${settings.logFontSize}px` : undefined,
        } as React.CSSProperties
      }
    >
      <MessageDialogHost />
      {asking && (
        <AskDialog
          key={asking.id}
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
      {isMac() && (
        <MenuBar
          checked={menuChecked}
          extra={
            masterShown && masterMenu
              ? {
                  name: masterMenu.caption,
                  items: masterMenu.menus.flatMap((m, i) => [
                    { id: "", text: m.caption, check: false },
                    ...m.items.map((it, j) =>
                      it === "-" ? { id: "-", text: "", check: false } : { id: `mm:${i}:${j}`, text: it.caption, check: false },
                    ),
                  ]),
                }
              : null
          }
        />
      )}
      <TabBar tabs={tabs} active={active} onSelect={setActive} onClose={close} onSettings={() => setSettingsOpen(true)} />
      {tab ? (
        <div className="main-body">
        <div className="log-area">
          <LogView key={tab.session} lines={tab.lines} follow={logFollow} />
          {/* 看板と priv の画面はタブごとに作り、裏のタブの分は隠して書きかけを残す(#63) */}
          {tabs
            .filter((t) => t.board)
            .map((t) => (
              <div key={t.session} style={{ display: t.session === tab.session ? "contents" : "none" }}>
                <BoardEditor
                  name={t.label}
                  onSend={(text) => {
                    sendLines(t.session, text);
                    update(t.session, (x) => ({ ...x, board: false }));
                  }}
                  onCancel={() => {
                    // 閉じる時は .! を送って書くのをやめる(MEditForm.cpp の FormClose)
                    sendLine(t.session, ".!");
                    update(t.session, (x) => ({ ...x, board: false }));
                  }}
                />
              </div>
            ))}
          {tab.list && (
            <ListOverlay
              list={tab.list}
              onChange={(l) => updateList(tab.session, () => l)}
              onSend={(text) => closeListAndSend(tab.session, text)}
              onMore={(text) => sendLine(tab.session, text)}
            />
          )}
        </div>
        {tabs
          .filter((p) => p.privOpen)
          .map((p) => (
            <div key={p.session} style={{ display: p.session === tab.session ? "contents" : "none" }}>
              <PrivPanel
                convs={p.privs}
                active={p.privActive}
                users={p.users}
                self={p.self}
                onSelect={(key) =>
                  update(p.session, (t) => ({
                    ...t,
                    privActive: key,
                    privs: t.privs.map((c) => (partnersKey(c.to) === key ? { ...c, unread: false } : c)),
                  }))
                }
                onOpen={(to) =>
                  update(p.session, (t) => ({
                    ...t,
                    privs: upsertConv(t.privs, to, (c) => c ?? { to: [...to].sort(), lines: [], unread: false }),
                    privActive: partnersKey(to),
                  }))
                }
                onSend={(to, text) => sendPriv(p.session, to, text)}
                onClose={() => update(p.session, (t) => ({ ...t, privOpen: false }))}
              />
            </div>
          ))}
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
          onPriv={() => togglePriv(tab.session)}
          session={tab.session}
          sessions={tabs.filter((t) => !t.closed).map((t) => t.session)}
          disabled={tab.closed}
        />
      )}
      <div className="status-bar">{tab ? (tab.closed ? "切断" : "接続中") : "キャラ選択"}</div>
    </div>
  );
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
const LogView = memo(function LogView(props: { lines: LogLine[]; follow: boolean }) {
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
});

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
  // 右クリックのタグメニュー(Philly の InputEdit の PopupMenu)
  const [tagMenu, setTagMenu] = useState<TagMenuAt | null>(null);
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
      if (allTab) props.sessions.forEach((s) => sendLine(s, text));
      else sendLine(props.session, text);
      const next = afterSend(ta.value, ta.selectionStart);
      ta.value = next.value;
      ta.setSelectionRange(next.caret, next.caret);
      // 送った行が見えるよう、カーソルの位置までスクロールする
      ta.blur();
      ta.focus();
    };
    // 全タブ発言は確かめてから送る。断ったら全タブ発言を解除し、入力欄はそのまま
    if (allTab) {
      confirmBox("全タブに発言します。\nよろしいですか？").then((ok) => {
        if (ok) deliver();
        else setAllTab(false);
        ta.focus();
      });
      return;
    }
    // Philly は大声の前に確認し、送ったら大声を解除する。「すべて大声」の後は確認しない
    if (loud && !allTab && !loudAll) {
      setLoudAsk({ deliver, ta });
      return;
    }
    deliver();
  }

  // メニューの 操作 の切り替え
  useEffect(() => {
    const onMenu = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id === "loud") {
        setLoud((v) => !v);
        setLoudAll(false);
      } else if (id === "all-tab") setAllTab((v) => !v);
      else if (id === "log-save") props.onLogSave(!props.logSave);
      else if (id === "log-follow") props.onLogFollow(!props.logFollow);
      else if (id === "open-log-dir") props.onOpenLogDir();
    };
    window.addEventListener(INPUT_MENU_EVENT, onMenu);
    return () => window.removeEventListener(INPUT_MENU_EVENT, onMenu);
  });

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
      {tagMenu && (
        <TagMenu
          at={tagMenu}
          onInsert={(v) => {
            tagMenu.ta.value = v;
          }}
          onClose={() => setTagMenu(null)}
        />
      )}
      <textarea
        className={loud ? "input-line loud" : "input-line"}
        disabled={props.disabled}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          e.preventDefault();
          setTagMenu({ x: e.clientX, y: e.clientY, ta: e.currentTarget });
        }}
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
