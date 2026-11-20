import { Channel, invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { latestRelease } from "./update.ts";
import { isMac, MenuBar } from "./MenuBar";
import { LogMenu, type LogMenuAt } from "./LogMenu";
import { selectedLines } from "./logCopy.ts";
import { MASTER_EXP, parseMasterMagic, runMasterItem, type MasterMenu } from "./masterMagic.ts";
import { afterSend, caretLine, prepareLine } from "./chat.ts";
import { SENT_EVENT, type Sent } from "./keyInput";
import { isNorthFix, isTextTarget, KEY_EVENT, MOUSE_EVENT, RELEASE_ALL, type ForwardedMouse, keyContext, runKeyAction, sendLine, sendLines, type ForwardedKey } from "./keyInput";
import { keyAction, listKeyAction, menuAction, moveCommand, moveInput, type AskOptions, type Mods, type MoveKey } from "./keys.ts";
import { MAX_UNCONFIRMED, walkable, Walker } from "./walker.ts";
import { BAG_ICON, BagPanel, ItemIcon, STATUS_ICON } from "./BagPanel.tsx";
import { PartyHud, PartyPanel } from "./PartyPanel.tsx";
import { AskDialog } from "./AskDialog";
import { alertBox, confirmBox, MessageDialogHost } from "./MessageDialog";
import { popupTagMenu } from "./TagMenuPopup";
import { assetUrl } from "./asset";
import { MAP_POP_EVENT, newPopState, popsFromLine } from "./mapPop.ts";
import { BoardEditor } from "./BoardEditor";
import { DEFAULT_SETTINGS, EXPERIMENT_EVENT, shortcutText, type Settings } from "./settings.ts";
import { DownloadPanel } from "./DownloadPanel";
import { MapView, type MapPlace } from "./map";
import { SettingsPanel } from "./SettingsPanel";
import { NewCharacter, WorldSelect } from "./NewCharacter";
import { capConvs, partnersKey, privLines, privPartners, upsertConv, usersFromEvent, type User } from "./priv.ts";
import { PrivLauncher, PrivWindow, type PrivConv } from "./PrivPanel";
import { ListOverlay } from "./ListOverlay";
import { listNo, listOk, moreNo, moveListCursor, receiveList, type ListFlow, type ListState } from "./list.ts";
import { trace } from "./trace.ts";
import { PREDICT_TICK_MS, Predictor } from "./predict.ts";
import { EAGLE_EYE_EVENT, MAP_HIDDEN_EVENT, MAP_LIST_EVENT, MAP_STATE_EVENT, PARTY_OPEN_EVENT, TRANSFER_NO, TRANSFER_YES, type ItemInfo, type MapListAction, type PartyMember, type MapState, type Spell, type UiEvent } from "./protocol";
import { Window } from "@tauri-apps/api/window";
import { LogLines } from "./LogLineList";
import { LogFind } from "./LogFind";
import { lightenColors, pushLine, pushLines, scopeLogCss, type LogLine } from "./logLines.ts";
import { createLogWriter } from "./logSave.ts";
import { characterTarget, needsCloseConfirm } from "./tabs.ts";
import { signAuthor } from "./signHead.ts";
import { castLines, loadSpellOrder, orderSpells, saveSpellOrder, SPELL_WAIT_MS, waitsForOrder } from "./spells.ts";
import { SpellBar } from "./SpellBar";
import { ArrowDownToLine, Check, FolderOpen, Import, Megaphone, MessageSquare, Layers, Plug, Plus, Save, Settings as SettingsIcon, Trash2, UserPlus, X } from "lucide-react";

// src-tauri/src/characters.rs の Store
type Character = { label: string; host: string; port: number };
type Store = { characters: Character[]; openTabs: string[] };

/** 入力欄のツールバーと同じ切り替えのメニュー項目(src-tauri/src/menu.rs の 操作)。App から InputEditor へ送る */
const INPUT_MENU = ["loud", "all-tab", "log-save", "log-follow", "open-log-dir"];
const INPUT_MENU_EVENT = "phi-input-menu";

/** 最後の #user からこれだけ何も届かなければ、#ulist の返事が届き終わった事にする */
const ULIST_QUIET_MS = 300;
/** 看板 (#more 〜 #end-more) 1 枚の行の上限 (#120) */
const SIGN_MAX_LINES = 500;

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
  /** priv の会話と相手を選ぶ欄を開いているか。会話そのものは相手ごとの窓(PrivConv の open) */
  privOpen: boolean;
  /** ログを保存しているか(Philly の LogAutoSave。タブごとに切り替える) */
  logSave: boolean;
  /** 裏にいる間に発言か priv が届いた */
  unread: boolean;
  /** 裏にいる間に HP か MP が減った */
  hurt: boolean;
  /** 追加発言(Philly の TalkAdd。キャラごと。#80) */
  talkAdd?: string;
  /** 看板などの本文(#more 〜 #end-more)の札。ログと同じ HTML の行。閉じたら null */
  sign?: string[] | null;
  /** 魔法の列に並べる呪文 (並びは固定。ui/src/spells.ts) と、番号が入れ替わるのを待っている間 */
  spells?: Spell[];
  spellWaiting?: boolean;
  /** 札の看板を書いた人と日付 (ui/src/signHead.ts)。看板でないお知らせは null */
  signAuthor?: { name: string; date: string } | null;
  /** 手持ちの 8 個(#v6 I)とインベントリ(#ex-inv)。v6 で届いた時だけ */
  items?: (ItemInfo | null)[];
  bag?: ItemInfo[] | null;
  bagOpen?: boolean;
  bagMessage?: string;
  /** 仲間の一覧(#v6 P。自分が先頭)。パーティに入っていなければ空 */
  party?: PartyMember[];
  partyOpen?: boolean;
  /** 仲間の発言("名前" > 本文)の行。入力欄の上のパーティのタブで出す */
  partyLines: LogLine[];
  /** パーティのタブを選んでいるか(Enter の発言が仲間だけに届き、ログ欄にパーティの発言だけを出す) */
  partyMode?: boolean;
  /** 全体のタブを見ている間に仲間の発言が届いた */
  partyUnread?: boolean;
};

/** priv の窓を一番前に出す時の重なりの順 */
const topZ = (convs: PrivConv[]) => Math.max(0, ...convs.map((c) => c.z ?? 0)) + 1;

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

/** ログを利用者の地域の日付のファイルに足す。保存先のパスを返す (ui/src/logSave.ts) */
const saveLog = createLogWriter((args) => invoke<string>("append_log", args));

/** 右クリックした時の、選んだ行(選んでいなければ押した行)。選んだ範囲がログ欄の外なら押した行 */
function linesAt(lines: LogLine[], target: Element): LogLine[] {
  const idOf = (n: Node | null) => {
    const el = n instanceof Element ? n : n?.parentElement;
    const id = el?.closest("[data-line]")?.getAttribute("data-line");
    return id === null || id === undefined ? null : Number(id);
  };
  const sel = window.getSelection();
  const picked =
    sel && !sel.isCollapsed ? [idOf(sel.anchorNode), idOf(sel.focusNode)].filter((n): n is number => n !== null) : [];
  const ids = picked.length > 0 ? picked : [idOf(target)].filter((n): n is number => n !== null);
  return selectedLines(lines, ids);
}

/** クリップボードへ書く。navigator.clipboard が使えない WebView では execCommand に戻る */
async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
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
  const [downloadOpen, setDownloadOpen] = useState(false);
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
  const [logHeight, setLogHeight] = useLogHeight();
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
      setSettings((s) => ({
        ...s,
        smoothMove: e.payload.smoothMove,
        singleWindow: e.payload.singleWindow,
        modern: e.payload.modern,
        mapVariety: e.payload.mapVariety,
        mapEffects: e.payload.mapEffects,
      })),
    );
    return () => {
      smooth.then((f) => f());
    };
  }, []);
  const [error, setError] = useState("");
  /** 失敗を知らせる。キャラの一覧の上と、タブを開いていれば今のタブのログにも出す。一覧の上だけだと、
   * タブを見ている間は「＋」を押すまで見えない (#134) */
  const fail = (message: string) => {
    setError(message);
    if (activeRef.current !== null) append(activeRef.current, systemNg(message));
  };
  // 画像の保存(#82)。map 窓と EagleEye が保存して、場所を知らせてくる
  useEffect(() => {
    const unlisten = listen<{ kind: string; path?: string; error?: string }>("phi-ss-saved", (e) => {
      const s = activeRef.current;
      if (s === null) return;
      const what = e.payload.kind === "map" ? "マップ" : "イーグルアイ";
      append(s, e.payload.path ? systemOk(`${what}の画像を保存しました(${e.payload.path})`) : systemNg(`${what}の画像を保存出来ません: ${e.payload.error}`));
    });
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ログ欄の右クリックメニュー(#81)
  const [logMenu, setLogMenu] = useState<LogMenuAt | null>(null);
  const [findOpen, setFindOpen] = useState(false);

  const reload = () =>
    invoke<Store>("list_characters")
      .then((s) => {
        setStore(s);
        return s;
      })
      .catch((e) => {
        fail(String(e));
        return null;
      });

  // 起動時に、前回開いていたタブへ接続し直す(Philly の TabSession.ini)。
  // StrictMode は開発時に effect を2回呼ぶので、1回だけにする
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // v0.1.71 までの拡張マップが localStorage に世界ごとに書いた地形を消す(拡張マップは v6 で取りやめた)
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("phi_automap")) localStorage.removeItem(k);
    } catch {
      // 読めない時は消す物も無い
    }
    invoke<string>("log_css")
      .then((css) => setLogCss(scopeLogCss(css)))
      .catch((e) => console.error(e));
    // 自動接続を切ってあれば、タブを開かずにキャラの一覧から選んで貰う
    Promise.all([reload(), invoke<Settings>("get_settings").catch(() => DEFAULT_SETTINGS)]).then(([s, st]) => {
      if (st.autoConnect) s?.openTabs.forEach((label) => connect(label));
    });
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
  // 表のタブの位置の予想。返事を待ちきった移動を進んだとみなす
  const predictor = useRef(new Predictor());
  /**
   * 予想を使うか。v6 の北固定で、#ex-pos の届く世界か #v6 G を送るサーバの時だけ(docs/05-protocol-v6.md の 4.4 と 7.2)。
   * #v6 G で確かめる時は位置を照らし合わせないので、#ex-pos は要らない
   */
  const predicting = (session: number) => {
    const map = mapStates.current.get(session)?.map;
    return session === activeRef.current && !!map?.v6 && isNorthFix(map) && (!!map.pos || predictor.current.confirms);
  };
  // スムーズ移動の歩き方(ui/src/walker.ts)。#v6 G を送るサーバで、スムーズ移動が有効な北固定の時だけ
  const walker = useRef(new Walker<Mods>());
  /** #more の中で届いた本文の行(セッションごと)。#end-more で札にする */
  const signLines = useRef(new Map<number, string[]>());
  /** 直近の 2 行 (タグ付きの生の行)。#more の前の「名前 (日付)」と区切りの線から、看板を書いた人を取る */
  const recentLines = useRef(new Map<number, string[]>());
  /** 読んでいる看板を書いた人。#more で決め、#end-more で札に付ける */
  const signAuthors = useRef(new Map<number, ReturnType<typeof signAuthor>>());
  /** カバンを開き、インベントリの中身を求める */
  /** 魔法の列の呪文を、今の番号で唱える。先頭以外なら、番号が入れ替わる (#v6 S が届く) まで次を押させない */
  const castSpell = (session: number, spell: Spell) => {
    const tab = tabsRef.current.find((t) => t.session === session);
    if (!tab || tab.spellWaiting || tab.closed) return;
    // cast の一覧は出さない
    listFlow(session).cancel += 1;
    sendLines(session, castLines(spell));
    if (waitsForOrder(spell)) {
      update(session, (t) => ({ ...t, spellWaiting: true }));
      window.setTimeout(() => update(session, (t) => (t.spellWaiting ? { ...t, spellWaiting: false } : t)), SPELL_WAIT_MS);
    }
  };
  const castSpellSlot = (session: number, n: number) => {
    const spell = tabsRef.current.find((t) => t.session === session)?.spells?.[n - 1];
    if (spell) castSpell(session, spell);
  };
  const openBag = (session: number) => {
    update(session, (t) => ({ ...t, bagOpen: true, bagMessage: "" }));
    sendLine(session, "#ex-inv list");
  };
  /** 看板の札を閉じる */
  const closeSign = (session: number) => {
    if (tabsRef.current.find((t) => t.session === session)?.sign) update(session, (t) => ({ ...t, sign: null }));
  };
  const walkWaiting = useRef(false);
  /** リストが出て歩くのを止めた。押したままのキーリピートでは歩き出さず、押し直すまで待つ */
  const walkHalted = useRef(false);
  const walking = (session: number) => settingsRef.current.smoothMove && predicting(session) && predictor.current.confirms;
  /** 押しているキーと追尾移動の向きで、次の1歩を送る。前の1歩を滑らせている間と、返事の来ていない移動が多い間は送らない */
  const stepWalker = (session: number | null) => {
    if (session === null || !walking(session)) return;
    // リスト(ゲートの行き先など)を出している間は歩かない。サーバは選択の最中の go を番号として読み、選択をやめてしまう。
    // 押していたキーは離したとみなし、閉じた後は押し直すまで歩かない
    if (tabsRef.current.find((t) => t.session === session)?.list) {
      walker.current.clear();
      walkHalted.current = true;
      return;
    }
    // 通れるか分からない所への1歩は、返事が来るまで次を送らない
    // あと何行送れるか。斜めは 2 行要る
    const room = predictor.current.uncertain ? 0 : Math.max(0, MAX_UNCONFIRMED - predictor.current.unconfirmed);
    const canStep = room > 0;
    // 斜めのうち壁の側の向きは送らず、壁に沿って滑らせる
    const pick = (keys: MoveKey[], mods: Mods) => {
      const texts = keys.map((k) => moveCommand(k, mods, true));
      const kept = predictor.current.pick(texts);
      return keys.filter((_, i) => kept.includes(texts[i]));
    };
    const s = walker.current.next(room, pick);
    // 返事を待って止まった時をトレースに残す(続く間は1回だけ)
    if (!canStep && !walkWaiting.current)
      trace(`walk wait unconfirmed=${predictor.current.unconfirmed} uncertain=${predictor.current.uncertain}`);
    walkWaiting.current = !canStep;
    if (!s) return;
    trace(`walk ${s.keys.join("")} ${s.ms}ms`);
    closeSign(session);
    for (const k of s.keys) {
      const text = moveCommand(k, s.mods, true);
      predictor.current.walkStep(text, s.ms, s.at);
      sendLine(session, text);
    }
    sendMapState(session);
  };
  // main 窓のフォーカスが外れると keyup が届かないので、押しているキーを全部離したとみなす
  useEffect(() => {
    const release = () => walker.current.clear();
    window.addEventListener("blur", release);
    return () => window.removeEventListener("blur", release);
  }, []);
  useEffect(() => {
    predictor.current.reset();
    walker.current.clear();
    if (active === null) return;
    const timer = setInterval(() => {
      if (predictor.current.tick()) sendMapState(activeRef.current);
      stepWalker(activeRef.current);
    }, PREDICT_TICK_MS);
    return () => {
      clearInterval(timer);
      predictor.current.reset();
      walker.current.clear();
      sendMapState(activeRef.current);
    };
  }, [active]);
  /** 移動を送る。位置を予想している時は数える */
  const sendMove = (session: number, text: string) => {
    closeSign(session);
    if (predicting(session)) predictor.current.sent(text);
    sendLine(session, text);
  };
  // マップを main 窓に出す(クラシック(1窓)の settings.singleWindow と、モダンの settings.modern)。mapPane は main 窓の中の地図を出しているか
  const [mapPane, setMapPane] = useState(true);
  const mapPaneRef = useRef(mapPane);
  mapPaneRef.current = mapPane;
  const mapPlace = (): MapPlace => (inMain(settingsRef.current) ? "main" : "map");
  const mapInMain = inMain(settings);
  // 同じ窓に出す間は map 窓を隠し、やめたら出し直す。切り替えた時だけ動かす(起動した時は map 窓の表示を変えない)
  const singleBefore = useRef(false);
  useEffect(() => {
    if (singleBefore.current === mapInMain) return;
    singleBefore.current = mapInMain;
    Window.getByLabel("map")
      .then(async (w) => {
        if (!w) return;
        if (mapInMain) {
          mapShown.current = false;
          await w.hide();
        } else if (!(await w.isVisible())) {
          await w.show();
          mapShown.current = true;
        }
        sendMapState(activeRef.current);
      })
      .catch(console.error);
  }, [mapInMain]);
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
        // 隠した map 窓には送らない。表示した時に送り直す(#75)
        const to = mapPlace();
        if (to === "map" ? !mapShown.current : !mapPaneRef.current) return;
        const s = mapStateSession.current;
        const state = s === null ? undefined : mapStates.current.get(s);
        const predict = predictor.current.offset;
        const w = predictor.current.walk;
        const walk = w && { ...w, at: performance.timeOrigin + w.at };
        trace("main emit");
        // 宛先は to で見分ける(map.tsx)。main 窓の中の地図にも届くよう、全部の窓へ送る
        emit(MAP_STATE_EVENT, { ...(state ?? { session: -1, mapset: "" }), predict, walk, to }).catch((e) => console.error(e));
      };
    }
    mapStatePort.current.port2.postMessage(null);
  };
  useEffect(() => sendMapState(active), [active]);
  // メニューの表示のモード(回転か北固定か)に、今のタブのモードのチェックを付ける。
  // モードはサーバが決めるので、地図を受けるたびに見る。変わった時だけ Rust へ送る
  const viewChecks = useRef<boolean | null>(null);
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
  const [viewMode, setViewMode] = useState<{ turn: boolean } | null>(null);
  const menuChecked = (id: string): boolean =>
    ({
      "map-turn": viewMode?.turn,
      "map-solid": viewMode && !viewMode.turn,
      "smooth-move": settings.smoothMove,
      "map-effects": settings.mapEffects,
      "map-variety": settings.mapVariety,
      "layout-classic2": !mapInMain,
      "layout-classic1": settings.singleWindow && !settings.modern,
      "layout-modern": settings.modern,
    })[id] ?? false;
  const syncViewChecks = (force = false) => {
    const s = activeRef.current === null ? undefined : mapStates.current.get(activeRef.current);
    if (!s?.map) return;
    const turn = !keyContext(s, true).northFix;
    if (!force && turn === viewChecks.current) return;
    viewChecks.current = turn;
    setViewMode({ turn });
    invoke("set_view_checks", { turn }).catch(console.error);
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
    const unlisten = listen("phi-map-ready", () => sendMapState(activeRef.current));
    return () => {
      unlisten.then((f) => f());
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
    const toggleMap = () => {
      // 同じ窓に出している時は、ログの左の地図を出し入れする。出すと地図が phi-map-ready を送り、状態を受け取る
      if (mapPlace() === "main") {
        mapPaneRef.current = !mapPaneRef.current;
        return setMapPane(mapPaneRef.current);
      }
      return Window.getByLabel("map").then(async (w) => {
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
    };
    /** 操作にしたら true */
    const onKey = (e: ForwardedKey): boolean => {
      // 前のタブ(Ctrl+Shift+Tab)。keys.ts は Ctrl と Shift を一緒に押したキーを扱わないので、ここで見る
      if (e.type === "keydown" && e.code === "Tab" && e.ctrlKey && e.shiftKey && !e.altKey) {
        nextTab(-1);
        return true;
      }
      const session = activeRef.current;
      if (session === null) return false;
      // 看板の札とカバンは Esc で閉じる
      if (e.type === "keydown" && e.code === "Escape" && tabsRef.current.find((t) => t.session === session)?.sign) {
        closeSign(session);
        return true;
      }
      if (e.type === "keydown" && e.code === "Escape" && tabsRef.current.find((t) => t.session === session)?.bagOpen) {
        update(session, (t) => ({ ...t, bagOpen: false }));
        return true;
      }
      if (e.type === "keydown" && e.code === "Escape" && tabsRef.current.find((t) => t.session === session)?.partyOpen) {
        update(session, (t) => ({ ...t, partyOpen: false }));
        return true;
      }
      const ctx = keyContext(mapStates.current.get(session), settingsRef.current.fullKeyMove);
      // リスト表示中は、番号・取り消し・カーソルのキーを移動より先に見る(Philly の KeyDown は KeyBindListMode が先)。
      // フルキー移動の 7・8・9 やテンキーの 2・4・6・8、上下の矢印は、リスト表示中は番号とカーソルになる
      const list = tabsRef.current.find((t) => t.session === session)?.list;
      const listAction = list && e.type === "keydown" ? listKeyAction(e, ctx) : null;
      if (list && listAction) {
        // 押し続けのリピートは、カーソルとチェックと、9(続き。押し続けるとページを次々に足す。#84)だけ受け付ける
        const repeatOk = "listCursor" in listAction || "listToggle" in listAction || ("listNo" in listAction && listAction.listNo === 9);
        if (e.repeat && !repeatOk) return true;
        if ("listNo" in listAction) {
          const r = listNo(list, listAction.listNo);
          if (r?.close) closeListAndSend(session, r.send);
          else if (r) requestMore(session, r.send);
        } else if ("send" in listAction) closeListAndSend(session, listAction.send);
        else if ("listOk" in listAction) closeListAndSend(session, listOk(list));
        else if ("focusInput" in listAction) focusInput();
        else updateList(session, (l) => moveListCursor(l, listAction));
        return true;
      }
      const move = moveInput(e, ctx);
      // 離したキーは、歩き方を切り替えた後でも残らないように必ず消す。map 窓のフォーカスが外れた時は全部消す
      if (e.type === "keyup" && e.code === RELEASE_ALL) {
        walker.current.clear();
        return true;
      }
      if (e.type === "keyup") walker.current.keyUp(e.code);
      if (move && ctx.northFix && walkable(move.key) && walking(session)) {
        trace(`main ${e.type} ${e.code}${e.repeat ? " repeat" : ""} walk`);
        if (e.type === "keydown" && !(e.repeat && walkHalted.current)) {
          walkHalted.current = false;
          walker.current.keyDown(e.code, move.key, move.mods);
        }
        stepWalker(session);
        return true;
      }
      // 押し続けた時は OS のキーリピートに任せ、keydown のたびに1歩送る(Philly より前のクライアントと同じ)。
      // サーバは1ティックに1行ずつ処理するので、リピートが速いと離した後も少し歩く。
      // 位置を予想する時だけは Philly と同じく、リピートは前の移動の返事(地図・「進めません」・予想)を待つ。
      // 待たないと予想がサーバより何歩も先へ進み、地図の外('?')ばかりを描く
      if (move) {
        trace(`main ${e.type} ${e.code}${e.repeat ? " repeat" : ""}`);
        const blocked =
          e.repeat && predicting(session) && predictor.current.waiting;
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
      if (!e.repeat) runKeyAction(action, session, { focusInput, nextTab, openBoard, toggleMap, cancelList, ask, systemMagic, castSpellSlot: (n) => castSpellSlot(session, n) });
      return true;
    };
    const onDom = (e: globalThis.KeyboardEvent) => {
      // ログの検索(Ctrl+F、macOS は Cmd+F)。入力欄にいても開く
      if (e.type === "keydown" && e.code === "KeyF" && (isMac() ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setFindOpen(true);
        document.querySelector<HTMLInputElement>(".log-find input")?.select();
        return;
      }
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
      if (id.startsWith("char:")) return openCharacter(id.slice("char:".length));
      // 接続・切断(#77)。全〜はタブ上の全キャラ
      const tabsNow = tabsRef.current;
      if (id === "all-connect") return tabsNow.filter((t) => t.closed).forEach((t) => connect(t.label, t.session));
      if (id === "all-disconnect") return tabsNow.filter((t) => !t.closed).forEach((t) => disconnect(t.session));
      if (id === "all-force-close") return tabsNow.filter((t) => !t.closed).forEach((t) => forceClose(t.session));
      if (id === "new-tab") return setActive(null);
      if (id === "bag-open") return session === null ? undefined : openBag(session);
      if (id === "party-open")
        return session === null ? undefined : update(session, (t) => ({ ...t, partyOpen: true, bagOpen: false }));
      if (id === "download") return setDownloadOpen(true);
      if (id === "open-config-dir") return void invoke("open_config_dir").catch((e) => fail(String(e)));
      if (id === "trace")
        return void invoke<boolean>("trace_on")
          .then((v) => invoke<string | null>("set_trace", { on: !v }))
          .then((path) => alertBox(path ? `時刻の記録を始めました。\n${path}` : "時刻の記録を止めました。"))
          .catch((e) => fail(String(e)));
      if (id === "debug")
        return void invoke<boolean>("toggle_debug")
          .then((on) => alertBox(on ? "デバッグ表示を始めました。" : "デバッグ表示を止めました。"))
          .catch((e) => fail(String(e)));
      if (id === "version") return void getVersion().then((v) => alertBox(`WPHI ${v}`));
      // ツール(#82)
      if (id === "reload-gra") return void invoke("reload_assets").catch((e) => fail(String(e)));
      if (id === "safety")
        return void confirmBox("窓の位置と大きさを初期化します。\nよろしいですか？").then(
          (ok) => ok && invoke("reset_windows").catch(console.error),
        );
      if (id === "guide") return void openUrl("https://s7k.github.io/wphi/guide/").catch((e) => fail(String(e)));
      if (id === "update-check")
        return void getVersion()
          .then(async (v) => {
            const r = await latestRelease(v);
            if (!r) return alertBox(`WPHI ${v} は最新です。`);
            if (await confirmBox(`新しい版 ${r.version} があります。\nダウンロードのページを開きますか？`)) await openUrl(r.url);
          })
          .catch((e) => fail(`新しい版を確かめる事が出来ません: ${e}`));
      if (session === null) return;
      // 入力欄のツールバーと同じ切り替え。状態は InputEditor が持つ
      if (INPUT_MENU.includes(id)) return void window.dispatchEvent(new CustomEvent(INPUT_MENU_EVENT, { detail: id }));
      if (id === "priv") return togglePriv(session);
      if (id === "log-find") return setFindOpen(true);
      const label = tabsRef.current.find((t) => t.session === session)?.label ?? "";
      if (id === "open-char-dir") return void invoke("open_character_dir", { label }).catch((e) => fail(String(e)));
      if (id === "ss-map" || id === "ss-eagleeye")
        return void emit("phi-ss", { kind: id.slice(3), label, to: mapPlace() }).catch(console.error);
      if (id === "talk-add") {
        const t = tabsRef.current.find((t) => t.session === session);
        return void ask({ title: "発言の前に付ける言葉", label: "発言の前に付ける言葉を入力してください(空欄なら付けない)", initial: t?.talkAdd ?? "" }).then((v) => {
          if (v === null) return;
          update(session, (t) => ({ ...t, talkAdd: v }));
          // 入力欄の今の行が空なら、そこにも入れる(Philly の EditTalkAdd)
          const ta = document.querySelector<HTMLTextAreaElement>(".input-line");
          if (ta && caretLine(ta.value, ta.selectionStart).text === "") ta.setRangeText(v, ta.selectionStart, ta.selectionStart, "end");
        });
      }
      if (id === "log-buffer-save") {
        const t = tabsRef.current.find((t) => t.session === session);
        if (!t) return;
        return void invoke<string>("save_log_buffer", { label: t.label, lines: t.lines.map((l) => l.html) })
          .then((path) => alertBox(`ログ欄の内容を保存しました。\n${path}`))
          .catch((e) => append(session, systemNg(String(e))));
      }
      const cur = tabsNow.find((t) => t.session === session);
      if (id === "connect") return cur?.closed ? void connect(cur.label, session) : undefined;
      if (id === "disconnect") return cur?.closed ? undefined : disconnect(session);
      if (id === "force-close") return cur?.closed ? undefined : forceClose(session);
      if (id === "close-tab") return askClose(session);
      if (id.startsWith("mm:")) return runMaster(id, session);
      // 選んだ項目はチェックが勝手に切り替わるので、今のモードに付け直す。サーバが切り替えたら地図を受けた時にまた付け直す
      if (["map-turn", "map-solid"].includes(id)) syncViewChecks(true);
      const action = menuAction(id);
      const openBoard = () => update(session, (t) => ({ ...t, board: true }));
      const cancelList = (n: number) => (listFlow(session).cancel += n);
      if (action) runKeyAction(action, session, { focusInput, nextTab, openBoard, toggleMap, cancelList, ask, systemMagic, castSpellSlot: (n) => castSpellSlot(session, n) });
    });
    // マップのマウス操作(Philly の MapForm.cpp の FormMouseDown)
    let lastFollow = 0;
    const mouse = listen<ForwardedMouse>(MOUSE_EVENT, (e) => {
      const m = e.payload;
      const session = activeRef.current;
      if (session === null) return;
      if (m.type === "hit") sendLine(session, "hit");
      else {
        // 追尾移動は長押しと同じ速さにする。スムーズ移動で歩く時は歩き方に任せる(ui/src/walker.ts)。
        // 位置を予想する時は前の移動の返事を待ち、他は FOLLOW_MS に1歩まで
        if (m.type === "follow" && walking(session)) {
          walker.current.setFollow(m.keys, "none");
          stepWalker(session);
          return;
        }
        if (m.type === "follow") {
          const now = performance.now();
          if ((predicting(session) && predictor.current.waiting) || now - lastFollow < FOLLOW_MS) return;
          lastFollow = now;
        }
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
    // 地図の上の仲間を選んだ時(map.tsx)
    const partyOpen = listen(PARTY_OPEN_EVENT, () => {
      const session = activeRef.current;
      if (session !== null) update(session, (t) => ({ ...t, partyOpen: true }));
    });
    return () => {
      partyOpen.then((f) => f());
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

  function onMapEvent(session: number, ev: UiEvent) {
    const s = mapStates.current.get(session) ?? { session, mapset: "" };
    switch (ev.type) {
      case "map":
        s.map = ev;
        trace("main map");
        if (session === activeRef.current) predictor.current.onMap(ev.pos ? `${ev.pos.x},${ev.pos.y}` : null, ev);
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
        // 盲目の間は、自分以外のマスが '/' で届く。道として予想しない
        if (session === activeRef.current) predictor.current.setBlind(ev.blind);
        break;
      case "party":
        s.party = ev.members.slice(1).map((m) => m.name);
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
    if (channel !== "talk" && channel !== "priv" && channel !== "party") return;
    const loud = /^(?:<[^>]*>)*\(/.test(html);
    if (session !== activeRef.current) update(session, (t) => (t.unread ? t : { ...t, unread: true }));
    // DM の発言などは点滅させない(Philly の NotFlashRegexp.ini。Rust 側で照合する)
    if (settingsRef.current.taskBarFlash && !loud && !noFlash && !document.hasFocus())
      getCurrentWindow().requestUserAttention(UserAttentionType.Informational).catch(console.error);
  }

  /**
   * 受けた priv を相手の組の会話に足し、その窓を開く(Philly.ini の PopupPrivForm)。
   * 畳んでいる窓は畳んだまま、見出しに未読の印を付ける
   */
  function addPriv(session: number, from: string, html: string) {
    // 返信する時の為に、相手の一覧を取り直す
    requestUlist(session);
    update(session, (t) => {
      const to = privPartners(from, html, t.self);
      if (to.length === 0) return t;
      const key = partnersKey(to);
      const line = shownTime(timePrefix()) + html;
      const privs = upsertConv(t.privs, to, (c) =>
        c
          ? { ...c, lines: pushLine(c.lines, line), open: true, unread: !!c.min }
          : // 送り主は /*to=*/ で宛先を好きに足せるので、返信が知らない相手にも届く(Philly と同じ)。初めて送る前に確かめる(#53)
            { to, lines: pushLine([], line), unread: false, confirm: to.length > 1, open: true, z: topZ(t.privs) },
      );
      return { ...t, privs: capConvs(privs, key) };
    });
  }

  /** 相手の組 key の会話の窓を f で書き換える */
  const updateConv = (session: number, key: string, f: (c: PrivConv, t: Tab) => PrivConv) =>
    update(session, (t) => ({ ...t, privs: t.privs.map((c) => (partnersKey(c.to) === key ? f(c, t) : c)) }));

  /** 仲間の発言をパーティのタブの行に足す。全体のタブを見ていれば、パーティのタブに未読の印を付ける */
  function addParty(session: number, html: string) {
    const line = shownTime(timePrefix()) + html;
    update(session, (t) => ({ ...t, partyLines: pushLine(t.partyLines, line), partyUnread: !t.partyMode }));
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
      for (const name of failed) append(session, systemNg(`「${name}」さんに送信出来ませんでした。`));
    });
    return true;
  }

  /** リストで選んだ時と取り消した時。v5y は #ex-list-mode-end を送らないので、送った時点でリストを閉じる */
  function closeListAndSend(session: number, text: string) {
    sendLine(session, text);
    closeList(session);
  }

  /** 続きのページを頼む。届くまで 9 を受け付けない(#84) */
  function requestMore(session: number, no: string) {
    sendLine(session, no);
    updateList(session, (l) => ({ ...l, waiting: true }));
  }

  /** リストを閉じて map 窓に知らせる */
  function closeList(session: number) {
    update(session, (t) => ({ ...t, list: null }));
    onMapEvent(session, { type: "list", active: false });
  }

  // 続けて届いた行は次のタスクでまとめて足す。1行ごとに足すと、行の数だけ描き直しとレイアウトが走る(#73)
  const pendingLines = useRef(new Map<number, { html: string; raw?: string }[]>());
  const linesPort = useRef<MessageChannel | null>(null);
  /** 画面に出す時刻。時刻を出さない設定なら空(LogDispTime) */
  const shownTime = (time: string) => (settingsRef.current.logDispTime ? time : "");
  const append = (session: number, html: string, raw?: string) => {
    const time = timePrefix();
    const line = { html: shownTime(time) + html, raw };
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

  // 自分で切断したセッション。切れた知らせが届いた時に、サーバから切れたのと見分ける
  const userClosing = useRef(new Set<number>());
  /**
   * 接続する。replace を渡すと、そのタブ(切れたタブ)で接続し直し、ログと priv はそのまま残す(Philly の 接続。#77)。
   * 渡さなければ新しいタブを開く
   */
  /** 登録したキャラを開く。タブがあればそのタブへ移り、切れていれば同じタブで繋ぎ直す。無ければ接続する。
   * 一覧の「接続」からも同じにする。新しいタブを作ると、同じキャラのタブが二重に開いた (#133) */
  function openCharacter(label: string) {
    const target = characterTarget(tabsRef.current, label);
    if (target.kind === "connect") return void connect(label);
    setActive(target.session);
    if (target.kind === "reconnect") void connect(label, target.session);
  }

  async function connect(label: string, replace?: number) {
    // connect が返る前に届いた分は貯めておき、タブを作ってから流す。Channel は onmessage の無い間に届いた分を捨てる(#70)
    const early: UiEvent[] = [];
    let handle: ((ev: UiEvent) => void) | null = null;
    const channel = new Channel<UiEvent>((ev) => (handle ? handle(ev) : early.push(ev)));
    let session: number;
    try {
      session = await invoke<number>("connect", { label, onEvent: channel });
    } catch (e) {
      fail(`${label}: ${e}`);
      return;
    }
    // 吹き出しと増減(ui/src/mapPop.ts)の為に、前の行から引き継ぐ物
    const popState = newPopState();
    handle = (ev) => {
      switch (ev.type) {
        case "log":
          append(session, ev.html, ev.raw);
          recentLines.current.set(session, [...(recentLines.current.get(session) ?? []), ev.raw ?? ""].slice(-2));
          {
            // #end-more が来ないまま続くと貯め続けるので、看板 1 枚の分に抑える (#120)
            const sign = signLines.current.get(session);
            if (sign && sign.length < SIGN_MAX_LINES) sign.push(ev.html);
          }
          notifyTalk(session, ev.channel, ev.html, !!ev.noFlash);
          if (ev.channel === "priv" && ev.from) addPriv(session, ev.from, ev.html);
          if (ev.channel === "party") addParty(session, ev.html);
          if (ev.raw) {
            // 唱えた呪文を覚える為、表でないタブの行も通す
            const pops = popsFromLine(ev.raw, popState);
            if (pops.length && session === activeRef.current && settingsRef.current.mapEffects)
              emit(MAP_POP_EVENT, { pops, to: mapPlace() }).catch(console.error);
          }
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
        case "connection": {
          // Philly と同じく、自分で切った時とサーバから切れた時で行を分ける(Character.cpp・PersonalThread.cpp)
          const mine = userClosing.current.delete(session);
          if (!tabsRef.current.find((t) => t.session === session)?.closed)
            if (mine) append(session, systemOk("--- 切断しました ---"));
            else {
              // 1 行目は Philly と同じ文言 (docs/04-client-spec.md)。繋ぎ直し方は次の行に出す (#132)
              append(session, systemNg("サーバーから切断されました。"));
              append(session, systemNg("ファイルのメニューの「接続」で繋ぎ直せます。"));
            }
          update(session, (t) => ({ ...t, closed: true }));
          break;
        }
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
        case "items":
          update(session, (t) => ({ ...t, items: ev.items }));
          break;
        case "spells":
          // 列の並びはキャラごとに最初に見た順で固定し、番号だけ今の物にする
          update(session, (t) => {
            const { order, ordered } = orderSpells(loadSpellOrder(t.label), ev.spells);
            saveSpellOrder(t.label, order);
            return { ...t, spells: ordered, spellWaiting: false };
          });
          break;
        case "party":
          // パーティを抜けたら、パーティのタブから全体へ戻す
          update(session, (t) => ({ ...t, party: ev.members, partyMode: ev.members.length ? t.partyMode : false }));
          onMapEvent(session, ev);
          break;
        case "bag":
          update(session, (t) => ({ ...t, bag: ev.items, bagMessage: "" }));
          break;
        case "bagRefused":
          update(session, (t) => ({ ...t, bagMessage: BAG_REFUSED[ev.reason] ?? `出し入れ出来ません(${ev.reason})` }));
          break;
        case "mode": {
          // 看板などの本文(#more 〜 #end-more)は、ログに流すのに加えて札に出す(試験中)
          const reading = signLines.current.get(session);
          if (ev.more && !reading) {
            signLines.current.set(session, []);
            signAuthors.current.set(session, signAuthor(recentLines.current.get(session) ?? []));
          } else if (!ev.more && reading) {
            signLines.current.delete(session);
            const author = signAuthors.current.get(session) ?? null;
            signAuthors.current.delete(session);
            if (reading.length) update(session, (t) => ({ ...t, sign: reading, signAuthor: author }));
          }
          onMapEvent(session, ev);
          break;
        }
        case "edit":
          // #m-edit で看板エディタを開き、#. で閉じる。#s-edit は Philly も何もしない(入力欄で答える)
          if (ev.mode === "multi") update(session, (t) => ({ ...t, board: true }));
          else if (ev.mode === "end") update(session, (t) => ({ ...t, board: false }));
          break;
        case "list": {
          // 続きのページは、出しているリストの下に足す(#84)。map 窓にも溜めた全部を出す
          const r = receiveList(listFlow(session), ev.active, ev.lines, tabsRef.current.find((t) => t.session === session)?.list);
          if (r === "close") closeList(session);
          else if (r) {
            // スムーズ移動で押し続けていても、ここで止める(stepWalker)
            if (session === activeRef.current && walking(session)) {
              walker.current.clear();
              walkHalted.current = true;
              trace("walk stop list");
            }
            update(session, (t) => ({ ...t, list: r }));
            onMapEvent(session, { ...ev, lines: r.lines });
          }
          break;
        }
        case "moved":
          if (session === activeRef.current && predictor.current.onMoved(ev.dx, ev.dy, ev.reason)) sendMapState(session);
          break;
        case "jumped":
          if (session === activeRef.current) {
            predictor.current.onJumped();
            sendMapState(session);
          }
          break;
        default:
          onMapEvent(session, ev);
      }
    };
    if (replace !== undefined) {
      forgetSession(replace);
      append(session, systemOk("サーバーに接続します..."));
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
        partyLines: [],
        logSave: false,
        unread: false,
        hurt: false,
      },
    ]);
    setActive(session);
    append(session, systemOk("サーバーに接続します..."));
    early.splice(0).forEach(handle);
  }

  /** 接続中のタブは、閉じる前に確かめる。切断してログと priv の会話も捨てるので、× の押し間違いで失う (#135) */
  function askClose(session: number) {
    const t = tabsRef.current.find((x) => x.session === session);
    if (!t || !needsCloseConfirm(t)) return close(session);
    void confirmBox(`「${t.label}」を切断してタブを閉じます。\nログと priv の会話も消えます。よろしいですか？`).then(
      (ok) => {
        if (ok) close(session);
      },
    );
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
    append(session, systemNg("--- 強制切断します ---"));
  }

  /** 切断(Philly の Close)。#x を送って切る。切れた知らせが届いた時に「切断しました」を出す */
  function disconnect(session: number) {
    userClosing.current.add(session);
    invoke("disconnect", { session }).catch(console.error);
  }

  /** セッションごとに覚えた物を消す(#35) */
  function forgetSession(session: number) {
    userClosing.current.delete(session);
    mapStates.current.delete(session);
    listFlows.current.delete(session);
    lastUlist.current.delete(session);
    pendingLines.current.delete(session);
    signLines.current.delete(session);
    signAuthors.current.delete(session);
    recentLines.current.delete(session);
    const wait = ulistWaits.current.get(session);
    if (wait) window.clearTimeout(wait.timer);
    ulistWaits.current.delete(session);
  }

  const tab = tabs.find((t) => t.session === active);

  // 看板の画面はタブごとに作り、裏のタブの分は隠して書きかけを残す(#63)。
  // モダンではログの枠が小さいので、ログ欄でなく main 窓いっぱいに重ねる
  const boards = tabs
    .filter((t) => t.board)
    .map((t) => (
      <div key={t.session} style={{ display: t.session === tab?.session ? "contents" : "none" }}>
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
    ));

  return (
    <div
      // モダンの暗い見た目は、地図を出しているタブだけ。キャラを選ぶ画面は今まで通りの明るい見た目にする
      className={["main", settings.logFontSize && "log-sized", settings.modern && tab && "modern"].filter(Boolean).join(" ")}
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
      {downloadOpen && <DownloadPanel onClose={() => setDownloadOpen(false)} />}
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
      <TabBar tabs={tabs} active={active} onSelect={setActive} onClose={askClose} onSettings={() => setSettingsOpen(true)} />
      {tab ? (
        <div className={settings.modern ? "main-body modern" : settings.singleWindow ? "main-body single" : "main-body"}>
        {settings.singleWindow && !settings.modern && mapPane && <MapPane />}
        {settings.modern && mapPane && (
          <div className="modern-map">
            <MapView embedded modern />
          </div>
        )}
        {settings.modern && boards}
        {tab.sign && <SignCard lines={tab.sign} author={tab.signAuthor ?? null} onClose={() => closeSign(tab.session)} />}
        {settings.modern && !tab.bagOpen && (
          <SpellBar spells={tab.spells ?? []} waiting={!!tab.spellWaiting} onCast={(sp) => castSpell(tab.session, sp)} />
        )}
        {tab.items && !tab.bagOpen && (
          <button type="button" className="bag-button" title="カバン(持ち物とインベントリ)" onClick={() => openBag(tab.session)}>
            <ItemIcon index={BAG_ICON} size={32} />
          </button>
        )}
        {/* モダンは地図の下のステータスの欄を出さないので、その「Status」と同じく check と look を送るボタンを置く */}
        {settings.modern && !tab.bagOpen && (
          <button
            type="button"
            className={tab.items ? "bag-button status-button-modern" : "bag-button"}
            title="ステータス(check と look)"
            onClick={() => sendLines(tab.session, "check\nlook")}
          >
            <ItemIcon index={STATUS_ICON} size={32} />
          </button>
        )}
        {!!tab.party?.length && !tab.partyOpen && !tab.bagOpen && (
          <PartyHud members={tab.party} besidePriv={!!tab.privOpen} onOpen={() => update(tab.session, (t) => ({ ...t, partyOpen: true, bagOpen: false }))} />
        )}
        {tab.partyOpen && !tab.bagOpen && (
          <PartyPanel
            members={tab.party ?? []}
            onBye={() =>
              void confirmBox("パーティを抜けます。\nよろしいですか？").then((ok) => ok && sendLine(tab.session, "bye"))
            }
            onClose={() => update(tab.session, (t) => ({ ...t, partyOpen: false }))}
          />
        )}
        {tab.bagOpen && (
          <BagPanel
            items={tab.items ?? []}
            bag={tab.bag ?? null}
            message={tab.bagMessage ?? ""}
            onPut={(slot) => sendLine(tab.session, `#ex-inv put ${slot}`)}
            onGet={(no) => sendLine(tab.session, `#ex-inv get ${no}`)}
            onSend={(text) => {
              // unequip は装備中の物の一覧を出してから番号を受け取る。番号も一緒に送るので、一覧は出さずに閉じる(Alt+数字の cast と同じ)
              if (text.startsWith("unequip")) listFlow(tab.session).cancel += 1;
              sendLines(tab.session, text);
            }}
            onClose={() => update(tab.session, (t) => ({ ...t, bagOpen: false }))}
          />
        )}
        <div className="log-area" style={settings.modern ? ({ "--log-h": `${logHeight}vh` } as React.CSSProperties) : undefined}>
          {settings.modern && <LogHeight value={logHeight} onChange={setLogHeight} />}
          <div
            className="log-menu-area"
            onContextMenu={(e) => {
              e.preventDefault();
              setLogMenu({ x: e.clientX, y: e.clientY, lines: linesAt(tab.lines, e.target as Element) });
            }}
          >
            {/* 検索中は最下行へ戻さない。戻すと、見つけた行が新しいログで流れる */}
            {/* タブごとに残して隠す。作り直すと最大 2000 行を描き直し、モダンでは全行の色を読み直す (#118) */}
            {tabs.map((t) => (
              <div
                key={`${t.session}${t.partyMode ? "p" : ""}`}
                className={t.session === tab.session ? "log-shown" : undefined}
                style={{ display: t.session === tab.session ? "contents" : "none" }}
              >
                <LogView
                  lines={t.partyMode ? t.partyLines : t.lines}
                  follow={logFollow && !findOpen}
                  light={settings.modern}
                />
              </div>
            ))}
          </div>
          {findOpen && (
            <LogFind
              key={tab.session}
              log={() => document.querySelector(".log-area .log-shown .phi-log")}
              lines={tab.lines}
              onClose={() => {
                setFindOpen(false);
                document.querySelector<HTMLElement>(".log-area .log-shown .phi-log")?.focus();
              }}
            />
          )}
          {logMenu && (
            <LogMenu
              at={logMenu}
              settings={settings}
              onCopy={(text) => copyToClipboard(text).catch((e) => fail(String(e)))}
              onToInput={(text) => {
                const ta = document.querySelector<HTMLTextAreaElement>(".input-line");
                if (!ta) return;
                ta.setRangeText(text + "\n", ta.selectionStart, ta.selectionEnd, "end");
                ta.focus();
              }}
              onSend={(text) => {
              // unequip は装備中の物の一覧を出してから番号を受け取る。番号も一緒に送るので、一覧は出さずに閉じる(Alt+数字の cast と同じ)
              if (text.startsWith("unequip")) listFlow(tab.session).cancel += 1;
              sendLines(tab.session, text);
            }}
              onShow={(text) => alertBox(text)}
              onToggle={(key) => {
                const next = { ...settings, [key]: !settings[key] };
                setSettings(next);
                invoke("save_settings", { settings: next }).catch((e) => fail(String(e)));
              }}
              onClose={() => setLogMenu(null)}
            />
          )}
          {!settings.modern && boards}
          {tab.list && (
            <ListOverlay
              list={tab.list}
              onChange={(l) => updateList(tab.session, () => l)}
              onSend={(text) => closeListAndSend(tab.session, text)}
              onMore={(text) => requestMore(tab.session, text)}
            />
          )}
        </div>
        {tabs
          .filter((p) => p.privOpen || p.privs.some((c) => c.open))
          .map((p) => (
            // priv の窓は前に出す度に z が増えるので、層に閉じ込めてカバンや設定、確かめるダイアログを覆わないようにする (#140)
            <div key={p.session} className="priv-layer" style={{ display: p.session === tab.session ? undefined : "none" }}>
              {p.privOpen && (
                <PrivLauncher
                  convs={p.privs}
                  users={p.users}
                  self={p.self}
                  onShow={(key) => updateConv(p.session, key, (c, t) => ({ ...c, open: true, min: false, unread: false, z: topZ(t.privs) }))}
                  onOpen={(to) =>
                    update(p.session, (t) => ({
                      ...t,
                      privs: upsertConv(t.privs, to, (c) => ({
                        ...(c ?? { to: [...to].sort(), lines: [], unread: false }),
                        open: true,
                        min: false,
                        z: topZ(t.privs),
                      })),
                    }))
                  }
                  onClose={() => update(p.session, (t) => ({ ...t, privOpen: false }))}
                />
              )}
              {p.privs
                .filter((c) => c.open)
                .map((c, i) => {
                  const key = partnersKey(c.to);
                  return (
                    <PrivWindow
                      key={key}
                      conv={c}
                      index={i}
                      onSend={(text) => sendPriv(p.session, c.to, text)}
                      onFront={() =>
                        updateConv(p.session, key, (c, t) =>
                          (c.z ?? 0) >= topZ(t.privs) - 1 && !c.unread ? c : { ...c, unread: false, z: topZ(t.privs) },
                        )
                      }
                      onMove={(x, y) => updateConv(p.session, key, (c) => ({ ...c, x, y }))}
                      onMin={(min) => updateConv(p.session, key, (c) => ({ ...c, min, unread: false }))}
                      onClose={() => updateConv(p.session, key, (c) => ({ ...c, open: false, unread: false }))}
                    />
                  );
                })}
            </div>
          ))}
        </div>
      ) : (
        <CharacterList
          store={store}
          error={error}
          onConnect={(label) => {
            setError("");
            openCharacter(label);
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
          talkAdd={tab.talkAdd ?? ""}
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
          party={tab.party?.length || tab.partyMode ? { mode: !!tab.partyMode, unread: !!tab.partyUnread } : null}
          onPartyMode={(on) => update(tab.session, (t) => ({ ...t, partyMode: on, partyUnread: on ? false : t.partyUnread }))}
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
          className={[
            "tab",
            t.session === props.active ? "active" : t.unread ? "unread" : "",
            // 切れたタブは見た目で分かるようにする。モダンは状態欄を出さないので、他に知る手段が無い (#132)
            t.closed ? "closed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          title={t.closed ? "切断中。ファイルのメニューの「接続」で繋ぎ直せます" : undefined}
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
            <X />
          </button>
        </span>
      ))}
      <button className="tab" title="キャラを選んで接続する" onClick={() => props.onSelect(null)}>
        <Plus />
      </button>
      <button className="tab tab-settings" onClick={props.onSettings}>
        <SettingsIcon />
        設定
      </button>
    </div>
  );
}

/**
 * ログ欄。follow が on の時は、ログが増えるたびと、中の画像が読み込まれて高さが変わるたびに最下行へ移る。
 * off は Philly の「ログスクロール停止」に当たる
 */
const LogView = memo(function LogView(props: { lines: LogLine[]; follow: boolean; light?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const follow = useRef(props.follow);
  follow.current = props.follow;

  const toBottom = () => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  };
  useEffect(toBottom, [props.lines, props.follow]);
  // モダンは地図の上に白い文字で出すので、色の付いた文字を白に寄せて薄くする(style.css の [data-lc])
  useLayoutEffect(() => {
    if (props.light && inner.current) lightenColors(inner.current);
  }, [props.lines, props.light]);
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
 * Ctrl+Enter はパーティの発言、Shift+Enter は改行。
 * value を React に持たせない。ログが届くたびの再描画で value を書き戻すと、WebKitGTK が変換中の文字を消す
 */
function InputEditor(props: {
  session: number;
  /** 追加発言(Philly の TalkAdd)。新しい行と、最後の行で ↓ を押した時の行をこれで始める */
  talkAdd: string;
  sessions: number[];
  disabled: boolean;
  onPriv: () => void;
  /** パーティに入っている間だけ出す、入力欄の上の「全体」「パーティ」のタブ */
  party: { mode: boolean; unread: boolean } | null;
  onPartyMode: (on: boolean) => void;
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
  // 連続送信を 100ms 空ける(Philly の SendFromInputEdit)
  const lastSend = useRef(0);

  function send(ta: HTMLTextAreaElement, ctrl: boolean) {
    const now = performance.now();
    if (now - lastSend.current < 100) return;
    lastSend.current = now;
    const line = caretLine(ta.value, ta.selectionStart);
    // パーティのタブでは、Ctrl+Enter と同じく仲間だけへ送る
    const text = prepareLine(line.text, {
      ctrl: ctrl || !!props.party?.mode,
      loud: loud && !allTab,
      lastLine: line.index + 1 >= line.count,
    });
    if (text === null) return;
    const deliver = () => {
      if (allTab) props.sessions.forEach((s) => sendLine(s, text));
      else sendLine(props.session, text);
      const next = afterSend(ta.value, ta.selectionStart, props.talkAdd);
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
      document.querySelector<HTMLElement>(".log-area .log-shown .phi-log")?.focus();
      return;
    }
    // 最後の行で ↓ を押したら、その行を追加発言にする(Philly の InputEditKeyDown)
    const ta = e.currentTarget;
    if (e.key === "ArrowDown" && !e.shiftKey && !e.ctrlKey && !e.altKey && props.talkAdd) {
      const line = caretLine(ta.value, ta.selectionStart);
      if (line.index + 1 >= line.count) {
        e.preventDefault();
        ta.setRangeText(props.talkAdd, line.start, line.start + line.text.length, "end");
        return;
      }
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
              <Check />
              はい
            </button>
            <button onClick={() => answerLoud("all")}>
              <Megaphone />
              すべて大声
            </button>
            <button onClick={() => answerLoud("no")}>
              <X />
              いいえ
            </button>
          </div>
        </div>
      )}
      <div className="input-toolbar">
        {props.party && (
          <div className="chat-tabs" role="tablist">
            <button role="tab" aria-selected={!props.party.mode} onClick={() => props.onPartyMode(false)}>
              全体
            </button>
            <button
              role="tab"
              aria-selected={props.party.mode}
              className={props.party.unread ? "unread" : undefined}
              title="仲間だけに発言し、仲間の発言だけを出す"
              onClick={() => props.onPartyMode(true)}
            >
              パーティ
            </button>
          </div>
        )}
        <label className={loud ? "toggle on" : "toggle"}>
          <input
            type="checkbox"
            checked={loud}
            onChange={(e) => {
              setLoud(e.target.checked);
              if (!e.target.checked) setLoudAll(false);
            }}
          />
          <Megaphone />
          {loudAll ? "すべて大声" : "大声"}
        </label>
        <label className={allTab ? "toggle on" : "toggle"}>
          <input type="checkbox" checked={allTab} onChange={(e) => setAllTab(e.target.checked)} />
          <Layers />
          全タブ発言
        </label>
        <label className={props.logFollow ? "toggle on" : "toggle"} title="ログが増えたら最下行へ移る">
          <input type="checkbox" checked={props.logFollow} onChange={(e) => props.onLogFollow(e.target.checked)} />
          <ArrowDownToLine />
          ログを固定
        </label>
        <label className={props.logSave ? "toggle on" : "toggle"}>
          <input type="checkbox" checked={props.logSave} onChange={(e) => props.onLogSave(e.target.checked)} />
          <Save />
          ログ保存
        </label>
        <button className="toggle" title="ログの保存先のフォルダを開く" onClick={props.onOpenLogDir}>
          <FolderOpen />
          保存先
        </button>
        <button className="toggle" onClick={props.onPriv}>
          <MessageSquare />
          priv
        </button>
      </div>
      <textarea
        className={loud ? "input-line loud" : "input-line"}
        disabled={props.disabled}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          e.preventDefault();
          const ta = e.currentTarget;
          popupTagMenu(ta, (v) => (ta.value = v)).catch(console.error);
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
                <button onClick={() => props.onConnect(c.label)}>
                  <Plug />
                  接続
                </button>
                <button
                  onClick={() =>
                    // キャラ ID のファイルも消すので、ID を控えていないとそのキャラに入れなくなる (#130)
                    void confirmBox(
                      `「${c.label}」を一覧から削除します。\nキャラ ID も消え、元に戻せません。よろしいですか？`,
                    ).then((ok) => {
                      if (ok) run(invoke("delete_character", { label: c.label }));
                    })
                  }
                >
                  <Trash2 />
                  削除
                </button>
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
        <WorldSelect
          host={host}
          port={port}
          onSelect={(h, p) => {
            setHost(h);
            setPort(p);
          }}
        />
        <label>
          サーバ <input value={host} onChange={(e) => setHost(e.target.value)} required />
        </label>
        <label>
          ポート <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" required />
        </label>
        <label>
          キャラ ID(登録済みのキャラの接続先だけを変える時は空欄)
          <input type="password" value={id} onChange={(e) => setId(e.target.value)} />
        </label>
        <button type="submit">
          <UserPlus />
          登録
        </button>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          invoke<string[]>("import_philly", { folder })
            .then((labels) => {
              setImported(labels.length ? `${labels.join("、")} を取り込みました` : "キャラが見つかりませんでした");
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
        <button type="submit">
          <Import />
          取り込む
        </button>
        {imported && <p>{imported}</p>}
      </form>

      <NewCharacter onCreated={props.onChanged} onError={props.onError} />
    </div>
  );
}

/** 追尾移動で、続けて送る間隔の下限(ms)。サーバは 0.1 秒に1行ずつ処理する */
const FOLLOW_MS = 110;

/**
 * 看板などの本文の札(試験中)。ログと同じ HTML で、タグの色と大きさを反映する。札は暗い地なので、色の付いた文字は
 * モダンのログと同じく白へ寄せる(lightenColors)。× か Esc か、歩くと閉じる。本文はログにも残る
 */
function SignCard(props: { lines: string[]; author: { name: string; date: string } | null; onClose: () => void }) {
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (body.current) lightenColors(body.current);
  }, [props.lines]);
  return (
    <div className="sign-card" role="dialog" aria-label="看板・お知らせ">
      <div className="sign-head">
        {/* 看板なら書いた人と日付。サーバが本文の前に送る行から取る (ui/src/signHead.ts) */}
        {props.author ? (
          <span title={`${props.author.name} (${props.author.date})`}>
            {props.author.name}
            <span className="sign-date">{props.author.date}</span>
          </span>
        ) : (
          <span>看板・お知らせ</span>
        )}
        <button type="button" title="閉じる(Esc)" onClick={props.onClose}>
          <X />
        </button>
      </div>
      <div className="sign-body" ref={body}>
        {props.lines.map((l, i) => (
          // html は phi-proto の tag_to_html がエスケープ済みで作ったもの(LogLineList.tsx と同じ)
          <div key={i} data-line={i} dangerouslySetInnerHTML={{ __html: l }} />
        ))}
      </div>
    </div>
  );
}

/** #ex-inv no の理由(phi_dm の phi_items.rs の ex_inv) */
const BAG_REFUSED: Record<string, string> = {
  off: "この世界ではカバンを使えません",
  empty: "その枠には何もありません",
  equipped: "装備中の物は入れられません",
  nobreak: "この物はカバンに入れられません",
  full: "カバンが一杯です",
  hand: "手持ちが一杯か、その物がありません",
  bad: "出し入れの指定が違います",
  error: "カバンに入れられませんでした",
};

/** マップを main 窓に出すか(クラシック(1窓)とモダン) */
const inMain = (s: Settings) => s.singleWindow || s.modern;

const LOG_HEIGHT_KEY = "wphi:modernLogHeight";
/** モダンのログの高さ(窓の高さの %)。小・中・大 */
const LOG_HEIGHTS: [string, number][] = [
  ["小", 20],
  ["中", 42],
  ["大", 65],
];

/** モダンのログの高さ。この窓の localStorage に覚える */
function useLogHeight(): [number, (v: number) => void] {
  const [h, setH] = useState(() => {
    try {
      const v = Number(localStorage.getItem(LOG_HEIGHT_KEY));
      return LOG_HEIGHTS.some(([, x]) => x === v) ? v : 42;
    } catch {
      return 42;
    }
  });
  const set = (v: number) => {
    setH(v);
    try {
      localStorage.setItem(LOG_HEIGHT_KEY, String(v));
    } catch {
      // 覚えられなくても、今の高さのまま使う
    }
  };
  return [h, set];
}

/** モダンのログの右上の、高さを選ぶボタン */
function LogHeight(props: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="log-height" role="group" aria-label="ログの高さ">
      {LOG_HEIGHTS.map(([label, v]) => (
        <button key={v} type="button" aria-pressed={props.value === v} onClick={() => props.onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

const MAP_PANE_KEY = "wphi:mapPaneWidth";
/** 地図の欄の下のステータス(.status-panel 50px と .map-status-bar 22px と線)と、右の方角と名前の欄(.map-side) */
const MAP_PANE_BELOW = 74;
const MAP_PANE_SIDE = 153;

/** ログの左に置く地図(settings.singleWindow)。境目をドラッグして幅を変え、この窓の localStorage に覚える。
 * 縦長の窓では、CSS で地図を上に積む */
function MapPane() {
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
