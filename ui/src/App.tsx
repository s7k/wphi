import { Channel, invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { latestRelease } from "./update.ts";
import { isMac, MenuBar } from "./MenuBar";
import { LogMenu, type LogMenuAt } from "./LogMenu";
import { selectedLines } from "./logCopy.ts";
import { MASTER_EXP, parseMasterMagic, runMasterItem, type MasterMenu } from "./masterMagic.ts";
import { caretLine } from "./chat.ts";
import { SENT_EVENT, type Sent } from "./keyInput";
import { isNorthFix, isTextTarget, KEY_EVENT, MOUSE_EVENT, RELEASE_ALL, type ForwardedMouse, keyContext, runKeyAction, sendLine, sendLines, type ForwardedKey } from "./keyInput";
import { escapeTarget, keyAction, listKeyAction, menuAction, moveCommand, moveInput, stepCommands, type AskOptions, type Mods, type MoveKey } from "./keys.ts";
import { MAX_UNCONFIRMED, walkable, Walker } from "./walker.ts";
import { BAG_ICON, BagPanel, ItemIcon, STATUS_ICON } from "./BagPanel.tsx";
import { PartyHud, PartyPanel } from "./PartyPanel.tsx";
import { AskDialog } from "./AskDialog";
import { alertBox, confirmBox, MessageDialogHost } from "./MessageDialog";
import { assetUrl } from "./asset";
import { MAP_POP_EVENT, newPopState, popsFromLine, stripTags } from "./mapPop.ts";
import { BoardEditor } from "./BoardEditor";
import { DEFAULT_SETTINGS, EXPERIMENT_EVENT, shortcutText, type Settings } from "./settings.ts";
import { DownloadPanel } from "./DownloadPanel";
import { MapView, type MapPlace } from "./map";
import { SettingsPanel } from "./SettingsPanel";
import { capConvs, ulistRequest, partnersKey, privLines, privPartners, upsertConv, usersFromEvent, type User } from "./priv.ts";
import { PrivLauncher, PrivWindow, type PrivConv } from "./PrivPanel";
import { ListOverlay } from "./ListOverlay";
import { checkAll, listNo, listOk, moreNo, moveListCursor, receiveList, type ListFlow, type ListState } from "./list.ts";
import { trace } from "./trace.ts";
import { PREDICT_TICK_MS, predictedMap, Predictor } from "./predict.ts";
import { selfPos } from "./mapRender.ts";
import { CHAR_ACTION_EVENT, EAGLE_EYE_EVENT, MAP_HIDDEN_EVENT, MAP_LIST_EVENT, MAP_STATE_EVENT, PARTY_FOLLOW_EVENT, type CharAction, PARTY_OPEN_EVENT, TRANSFER_NO, TRANSFER_YES, type ItemInfo, type MapListAction, type PartyMember, type MapState, type Spell, type UiEvent } from "./protocol";
import { Window } from "@tauri-apps/api/window";
import { LogFind } from "./LogFind";
import { pushLine, pushLines, scopeLogCss, type LogLine } from "./logLines.ts";
import { createLogWriter } from "./logSave.ts";
import { characterTarget, needsCloseConfirm } from "./tabs.ts";
import { signLine, signMode, type SignReading } from "./signHead.ts";
import { afterClose, DEAD_LINE, KICKED_LINE, lossText, RETRY_DELAYS } from "./reconnect.ts";
import { applyMapset, holdMapset, type PendingMapset } from "./mapsetPending.ts";
import { castLines, loadSpellOrder, moveSpell, orderSpells, saveSpellOrder, SPELL_WAIT_MS, waitsForOrder } from "./spells.ts";
import { SpellBar } from "./SpellBar";
import { followGoal, followStep, targetPos, type FollowMemory } from "./follow.ts";
import { TabBar } from "./TabBar";
import { LogView } from "./LogView";
import { INPUT_MENU, INPUT_MENU_EVENT, InputEditor } from "./InputEditor";
import { CharacterList } from "./CharacterList";
import { SignCard } from "./SignCard";
import { LOG_HEIGHT_KEY, LOG_HEIGHTS, LOG_WIDTH_KEY, LOG_MAX_KEY, useStored, LogHeight, LogWidthHandle } from "./LogControls";
import { MapPane } from "./MapPane";

// src-tauri/src/characters.rs の Store
type Character = { label: string; host: string; port: number };
export type Store = { characters: Character[]; openTabs: string[] };


/** 最後の #user からこれだけ何も届かなければ、#ulist の返事が届き終わった事にする */
const ULIST_QUIET_MS = 300;
/** 裏のタブでついて行く時、1 歩送ってから移動の返事も地図も届かなければ、次を送るまで待つ上限 (ms) */
const FOLLOW_PENDING_MS = 600;

export type Tab = {
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
  /** ついて行っている仲間の名前 (ui/src/follow.ts) */
  following?: string | null;
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

/** 新しい版があれば、Release のページを開くか聞く。quiet なら最新の時に何も出さない (起動の時) */
async function checkUpdate(quiet: boolean) {
  const v = await getVersion();
  const r = await latestRelease(v);
  if (!r) return quiet ? undefined : alertBox(`WPHI ${v} は最新です。`);
  if (await confirmBox(`新しい版 ${r.version} があります。\nダウンロードのページを開きますか？`)) await openUrl(r.url);
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
  const [logHeight, setLogHeight] = useStored(LOG_HEIGHT_KEY, 42, (v) => LOG_HEIGHTS.some(([, x]) => x === v));
  // モダンのログの横幅 (px。0 なら CSS の既定) と、窓いっぱいに広げてログだけ見るモード
  const [logWidth, setLogWidth] = useStored(LOG_WIDTH_KEY, 0);
  const [logMax, setLogMax] = useStored(LOG_MAX_KEY, 0);
  // 新しい版があれば、Release のページを開くか聞く(#25)。見られなくても何も出さない
  useEffect(() => {
    checkUpdate(true).catch(console.error);
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
  /** 地図より先に届き、まだ地図の状態へ入れていないマップセット (#mapset と #mapset-define / #v6 D)。次の地図で入れる */
  const pendingMapsets = useRef(new Map<number, PendingMapset>());
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
  /** #more の中で届いた本文の行と書いた人 (セッションごと)。#end-more で札にする (ui/src/signHead.ts) */
  const signReads = useRef(new Map<number, SignReading>());
  /** 世界移動の確かめの窓。期限が切れたら取り下げる (#153) */
  const transferAsks = useRef(new Map<number, AbortController>());
  /** 直近の 2 行 (タグ付きの生の行)。#more の前の「名前 (日付)」と区切りの線から、看板を書いた人を取る */
  const recentLines = useRef(new Map<number, string[]>());
  /** 魔法の列の呪文を、今の番号で唱える。先頭以外なら、番号が入れ替わる (#v6 S が届く) まで次を押させない */
  const castSpell = (session: number, spell: Spell) => {
    const tab = tabOf(session);
    if (!tab || tab.spellWaiting || tab.closed) return;
    // cast の一覧は出さない
    listFlow(session).cancel += 1;
    sendLines(session, castLines(spell));
    if (waitsForOrder(spell)) {
      update(session, (t) => ({ ...t, spellWaiting: true }));
      // 前の詠唱のタイマーは消す。残すと、次の詠唱の待ちを早く解き、古い番号で別の呪文を唱えた (#162)
      clearSpellWait(session);
      spellWaitTimers.current.set(
        session,
        window.setTimeout(() => {
          spellWaitTimers.current.delete(session);
          update(session, (t) => (t.spellWaiting ? { ...t, spellWaiting: false } : t));
        }, SPELL_WAIT_MS),
      );
    }
  };
  /** 詠唱の待ちを解くタイマー。呪文の並び (#v6 S) が届いた時と、次に唱える時に消す */
  const spellWaitTimers = useRef(new Map<number, number>());
  const clearSpellWait = (session: number) => {
    window.clearTimeout(spellWaitTimers.current.get(session));
    spellWaitTimers.current.delete(session);
  };
  /** 魔法の列を並べ替えて、キャラの並びとして保存する */
  const moveSpellTile = (session: number, from: number, to: number) =>
    update(session, (t) => {
      const shown = (t.spells ?? []).map((s) => s.name);
      const order = moveSpell(loadSpellOrder(t.label), shown, from, to);
      saveSpellOrder(t.label, order);
      return { ...t, spells: orderSpells(order, t.spells ?? []).ordered };
    });
  const castSpellSlot = (session: number, n: number) => {
    const spells = tabOf(session)?.spells;
    // 魔法の列が無いサーバ (#v6 S を送らない) では、所持魔法の何番目かを唱える (Philly の Alt+数字)
    if (!spells?.length) {
      listFlow(session).cancel += 1;
      sendLines(session, `cast\n${n}`);
      return;
    }
    if (spells[n - 1]) castSpell(session, spells[n - 1]);
  };
  /** カバンの操作を送る。前の操作で断られた理由 (bagMessage) は、ここで消す */
  const sendBag = (session: number, lines: string) => {
    update(session, (t) => (t.bagMessage ? { ...t, bagMessage: "" } : t));
    sendLines(session, lines);
  };
  /** 足元の店の買い取りへ全部渡す。渡した物は戻せないので、捨てる時と同じく確かめる */
  const offer = (session: number) =>
    void confirmBox("足元の店が買い取る物を、カバンと手持ち(装備中の物を除く)から全部渡します。\n渡した物は戻せません。よろしいですか？").then(
      (ok) => ok && sendBag(session, "#ex-inv offer"),
    );
  /** 持ち物の操作を送る。unequip は装備中の物の一覧を出してから番号を受け取るが、番号も一緒に送るので一覧は出さない (Alt+数字の cast と同じ) */
  const sendItemLines = (session: number, text: string) => {
    if (text.startsWith("unequip")) listFlow(session).cancel += 1;
    sendLines(session, text);
  };
  /** カバンを開き、インベントリの中身を求める */
  const openBag = (session: number) => {
    // パーティの窓は閉じる。カバンの間は描かないが開いたままにしていた為、カバンを閉じると勝手に戻ってきた
    update(session, (t) => ({ ...t, bagOpen: true, partyOpen: false, bagMessage: "" }));
    sendLine(session, "#ex-inv list");
  };
  /** 看板の札を閉じる */
  const closeSign = (session: number) => {
    if (tabOf(session)?.sign) update(session, (t) => ({ ...t, sign: null }));
  };
  const walkWaiting = useRef(false);
  /** リストが出て歩くのを止めた。押したままのキーリピートでは歩き出さず、押し直すまで待つ */
  const walkHalted = useRef(false);
  const walking = (session: number) => settingsRef.current.smoothMove && predicting(session) && predictor.current.confirms;
  /** ついて行っている仲間と、ゲートの覚え (ui/src/follow.ts の followGoal) */
  /** pending は裏のタブで 1 歩送った時刻。移動の返事か地図が届くまで次を送らない */
  const follows = useRef(new Map<number, { name: string; mem: FollowMemory; lastSend: number; pending?: number }>());
  const startFollow = (session: number, name: string) => {
    follows.current.set(session, { name, mem: {}, lastSend: 0 });
    update(session, (t) => ({ ...t, following: name }));
    append(session, systemOk(`${name} について行きます。移動のキーか Esc でやめます。`));
  };
  const stopFollow = (session: number, message?: string) => {
    const was = follows.current.delete(session);
    // follows に無くても帯 (following) は消す。再接続の後に帯だけが残り、「やめる」で消えなかった (#160)
    if (!was && !tabOf(session)?.following) return;
    if (session === activeRef.current) walker.current.clear();
    update(session, (t) => ({ ...t, following: null }));
    if (was) append(session, systemOk(message ?? "ついて行くのをやめました。"));
  };
  /**
   * ついて行く 1 回分。見回り (PREDICT_TICK_MS) ごとに、ついて行っている全部のタブについて呼ぶ。
   * 表のタブは位置の予想を使い、スムーズ移動の歩き方か go で送る。裏のタブは最後に届いた地図から決め、
   * 1 歩送ったら移動の返事か地図が届くまで待つ (位置の予想は表のタブの分しか無い)
   */
  const followTick = (session: number | null) => {
    if (session === null) return;
    const f = follows.current.get(session);
    if (!f) return;
    if (session !== activeRef.current) return followBackground(session, f);
    const s = mapStates.current.get(session);
    const raw = s?.map;
    const walk = predictor.current.walk;
    // walk (#v6 G で確かめた歩いた位置) はログインしてから一度歩くまで無い。無くても歩き始め、ゲートの判断だけ省く
    const party = followParty(session, f.name, raw);
    if (!raw || !party) return;
    const o = predictor.current.offset;
    const map = predictedMap(raw, o.dx, o.dy);
    const me = selfPos(map.width, map.height, false);
    const now = performance.now();
    const g = followGoal(f.mem, targetPos(map, f.name, party), walk, me, now);
    if (g.lost) return stopFollow(session, `${f.name} を見失いました。ついて行くのをやめました。`);
    if (!g.goal) return;
    const step = followStep(map, g.goal, g.onto);
    if (!step || step === "arrived") return;
    if (walking(session)) {
      // スムーズ移動の歩き方に、追尾移動と同じく向きを渡す (120ms 届かなければ止まる)
      walker.current.setFollow([step], "none");
      return;
    }
    // 1 歩ずつ地図が変わる時は、前の移動の返事を待ち、FOLLOW_MS に 1 歩まで
    if (predictor.current.waiting || now - f.lastSend < FOLLOW_MS) return;
    f.lastSend = now;
    sendMove(session, moveCommand(step, "none", true));
  };
  /** ついて行ける時は仲間の一覧を返す。v6 の北固定の地図でない時と、相手がパーティにいない時はやめる */
  const followParty = (session: number, name: string, raw: MapState["map"]) => {
    if (!raw?.v6 || !isNorthFix(raw)) {
      if (raw) stopFollow(session, "ついて行けるのは、v6 のサーバで北固定の地図の時だけです。");
      return null;
    }
    const party = tabOf(session)?.party ?? [];
    if (!party.some((m) => m.name === name)) {
      stopFollow(session, `${name} はパーティにいません。ついて行くのをやめました。`);
      return null;
    }
    return party;
  };
  /** 裏のタブのついて行く 1 回分。ゲートで飛んだかの判断は省く (歩いた位置を確かめる予想が無い) */
  const followBackground = (session: number, f: { name: string; mem: FollowMemory; lastSend: number; pending?: number }) => {
    const raw = mapStates.current.get(session)?.map;
    const party = followParty(session, f.name, raw);
    if (!raw || !party) return;
    const now = performance.now();
    if (f.pending !== undefined && now - f.pending < FOLLOW_PENDING_MS) return;
    const me = selfPos(raw.width, raw.height, false);
    const g = followGoal(f.mem, targetPos(raw, f.name, party), undefined, me, now);
    if (g.lost) return stopFollow(session, `${f.name} を見失いました。ついて行くのをやめました。`);
    if (!g.goal) return;
    const step = followStep(raw, g.goal, g.onto);
    if (!step || step === "arrived" || now - f.lastSend < FOLLOW_MS) return;
    f.lastSend = now;
    f.pending = now;
    sendMove(session, moveCommand(step, "none", true));
  };
  /** 押しているキーと追尾移動の向きで、次の1歩を送る。前の1歩を滑らせている間と、返事の来ていない移動が多い間は送らない */
  const stepWalker = (session: number | null) => {
    if (session === null || !walking(session)) return;
    // リスト(ゲートの行き先など)を出している間は歩かない。サーバは選択の最中の go を番号として読み、選択をやめてしまう。
    // 押していたキーは離したとみなし、閉じた後は押し直すまで歩かない
    if (tabOf(session)?.list) {
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
      const texts = stepCommands(keys, mods, true);
      const kept = predictor.current.pick(texts);
      return keys.filter((_, i) => kept.includes(texts[i]));
    };
    walker.current.weight = settingsRef.current.smoothWeight ?? 0;
    const s = walker.current.next(room, pick);
    // 返事を待って止まった時をトレースに残す(続く間は1回だけ)
    if (!canStep && !walkWaiting.current)
      trace(`walk wait unconfirmed=${predictor.current.unconfirmed} uncertain=${predictor.current.uncertain}`);
    walkWaiting.current = !canStep;
    if (!s) return;
    trace(`walk ${s.keys.join("")} ${s.ms}ms`);
    closeSign(session);
    for (const text of stepCommands(s.keys, s.mods, true)) {
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
      // 裏のタブのキャラも、ついて行く間は歩く
      for (const session of [...follows.current.keys()]) followTick(session);
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
  /** セッションのタブ。描き直しを待たない今の物 */
  const tabOf = (session: number | null) => tabsRef.current.find((t) => t.session === session);

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
    // キーとメニューの操作 (runKeyAction) に渡す物。キーとメニューで同じ物を組み立てていた
    const keyHooks = (session: number) => ({
      focusInput,
      nextTab,
      openBoard: () => update(session, (t) => ({ ...t, board: true })),
      toggleMap,
      cancelList: (n: number) => (listFlow(session).cancel += n),
      ask,
      systemMagic,
      castSpellSlot: (n: number) => castSpellSlot(session, n),
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
      // カバン・パーティ・看板の札・priv の欄は Esc で閉じる。閉じる順は ui/src/keys.ts の escapeTarget
      const esc = e.type === "keydown" && e.code === "Escape" ? escapeTarget(tabOf(session), follows.current.has(session)) : null;
      if (esc) {
        if (esc === "bag") update(session, (t) => ({ ...t, bagOpen: false }));
        else if (esc === "party") update(session, (t) => ({ ...t, partyOpen: false }));
        else if (esc === "sign") closeSign(session);
        else if (esc === "priv") update(session, (t) => ({ ...t, privOpen: false }));
        else stopFollow(session);
        return true;
      }
      const ctx = keyContext(mapStates.current.get(session), settingsRef.current.fullKeyMove);
      // リスト表示中は、番号・取り消し・カーソルのキーを移動より先に見る(Philly の KeyDown は KeyBindListMode が先)。
      // フルキー移動の 7・8・9 やテンキーの 2・4・6・8、上下の矢印は、リスト表示中は番号とカーソルになる
      const list = tabOf(session)?.list;
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
        else if ("listAll" in listAction) updateList(session, checkAll);
        else if ("focusInput" in listAction) focusInput();
        else updateList(session, (l) => moveListCursor(l, listAction));
        return true;
      }
      const move = moveInput(e, ctx);
      // 自分で歩いたら、ついて行くのをやめる
      if (move && e.type === "keydown" && follows.current.has(session)) stopFollow(session);
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
      if (!e.repeat) runKeyAction(action, session, keyHooks(session));
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
      // カバンなどの窓の中では、Tab は窓のボタンを順に辿る (入力欄へ飛ばすと、キーでは窓のボタンに届かなかった)
      if (e.code === "Tab" && (e.target as Element | null)?.closest?.("[role=dialog]")) return;
      if (onKey({ ...pick(e), type: e.type as "keydown" | "keyup" })) e.preventDefault();
    };
    document.addEventListener("keydown", onDom);
    document.addEventListener("keyup", onDom);
    // マウスで押したボタンにフォーカスが残ると、後の Enter で同じ操作がもう一度動き (全部渡す・ついて行く など)、
    // 魔法のアイコンなら Shift+← → で向きを変えずに並びが入れ替わった。押した後はログへ戻す。
    // キーで押した時 (detail 0) と、文字を打つ窓 (設定・問い・確認・看板・priv・検索) の中は戻さない。
    // 押した処理が別の所へフォーカスを移した時 (カバンを開いた時など) も、そちらを残す
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0) return;
      const b = (e.target as Element | null)?.closest?.("button, [role=tab]");
      if (!b || b.closest(".settings-panel, .ask-backdrop, .board-editor, .priv-panel, .priv-layer, .log-find, .input-area")) return;
      requestAnimationFrame(() => {
        if (document.activeElement === b || document.activeElement === document.body)
          document.querySelector<HTMLElement>(".log-area .log-shown .phi-log")?.focus();
      });
    };
    document.addEventListener("click", onClick);
    const forwarded = listen<ForwardedKey>(KEY_EVENT, (e) => onKey(e.payload));
    // リスト表示中に何かを送ったら、続きのページの番号(ずれ+9)でない限りリストを閉じる(Philly の SendTextListCancel)。
    // v5y は「番号ではありません」でリストを取り消しても、リストの終わりを送ってこない
    const onSent = ({ session, text }: Sent) => {
      const list = tabOf(session)?.list;
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
      // カバンの操作は、断られた理由 (#ex-inv no) がカバンの画面に出るので、開いてから送る
      if (id === "bag-stash" && session !== null) {
        // 装備中以外の手持ちを、枠の後ろから入れる (入れるたびに後ろの枠が詰まる為)
        const hand = tabOf(session)?.items ?? [];
        const slots = hand.flatMap((it, i) => (it && it.eq === "-" ? [i + 1] : [])).reverse();
        openBag(session);
        if (slots.length) sendBag(session, slots.map((k) => `#ex-inv put ${k}`).join("\n"));
        return;
      }
      if (id === "bag-pick" && session !== null) {
        openBag(session);
        sendBag(session, "#ex-inv pick");
        return;
      }
      if (id === "bag-offer" && session !== null) {
        openBag(session);
        offer(session);
        return;
      }
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
      if (id === "update-check") return void checkUpdate(false).catch((e) => fail(`新しい版を確かめる事が出来ません: ${e}`));
      // キャラのタブで使う項目。黙って何もしないと、押した事が届いたか分からない (#172)
      if (session === null) return void alertBox("キャラに接続してから選んでください。");
      // 入力欄のツールバーと同じ切り替え。状態は InputEditor が持つ
      if (INPUT_MENU.includes(id)) return void window.dispatchEvent(new CustomEvent(INPUT_MENU_EVENT, { detail: id }));
      if (id === "priv") return togglePriv(session);
      if (id === "log-find") return setFindOpen(true);
      const label = tabOf(session)?.label ?? "";
      if (id === "open-char-dir") return void invoke("open_character_dir", { label }).catch((e) => fail(String(e)));
      if (id === "ss-map" || id === "ss-eagleeye")
        return void emit("phi-ss", { kind: id.slice(3), label, to: mapPlace() }).catch(console.error);
      if (id === "talk-add") {
        const t = tabOf(session);
        return void ask({ title: "発言の前に付ける言葉", label: "発言の前に付ける言葉を入力してください(空欄なら付けない)", initial: t?.talkAdd ?? "" }).then((v) => {
          if (v === null) return;
          update(session, (t) => ({ ...t, talkAdd: v }));
          // 入力欄の今の行が空なら、そこにも入れる(Philly の EditTalkAdd)
          const ta = document.querySelector<HTMLTextAreaElement>(".input-line");
          if (ta && caretLine(ta.value, ta.selectionStart).text === "") ta.setRangeText(v, ta.selectionStart, ta.selectionStart, "end");
        });
      }
      if (id === "log-buffer-save") {
        const t = tabOf(session);
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
      if (action) runKeyAction(action, session, keyHooks(session));
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
        for (const text of stepCommands(m.keys, "none", northFix)) sendMove(session, text);
      }
    });
    // map 窓のリストのクリック(#9)
    const mapList = listen<MapListAction>(MAP_LIST_EVENT, (e) => {
      const session = activeRef.current;
      const list = tabOf(session)?.list;
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
    const partyFollow = listen<string>(PARTY_FOLLOW_EVENT, (e) => {
      const session = activeRef.current;
      if (session !== null) startFollow(session, e.payload);
    });
    // 地図のキャラのメニューの、ささやく・お金を渡す (#192)
    const charAction = listen<CharAction>(CHAR_ACTION_EVENT, (e) => {
      const session = activeRef.current;
      if (session === null) return;
      const { action, name, turn } = e.payload;
      if (action === "priv") {
        requestUlist(session);
        update(session, (t) => ({
          ...t,
          privs: upsertConv(t.privs, [name], (c) => ({ ...(c ?? { to: [name], lines: [], unread: false }), open: true, min: false, z: topZ(t.privs) })),
        }));
      } else
        void ask({ title: "お金を渡す", label: `${name} に渡す金額`, numeric: true }).then((v) => {
          if (v) sendLines(session, turn ? `turn ${turn}\npay ${v}` : `pay ${v}`);
        });
    });
    return () => {
      partyOpen.then((f) => f());
      partyFollow.then((f) => f());
      charAction.then((f) => f());
      document.removeEventListener("keydown", onDom);
      document.removeEventListener("keyup", onDom);
      document.removeEventListener("click", onClick);
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
      case "map": {
        s.map = ev;
        // 地図より先に届いたマップセットは、この地図と一緒に地図の窓へ送る (ui/src/mapsetPending.ts)
        applyMapset(s, pendingMapsets.current.get(session));
        pendingMapsets.current.delete(session);
        const f = follows.current.get(session);
        if (f) f.pending = undefined;
        trace("main map");
        if (session === activeRef.current) predictor.current.onMap(ev.pos ? `${ev.pos.x},${ev.pos.y}` : null, ev);
        break;
      }
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
        s.partyPos = ev.members.slice(1).flatMap((m) => (m.dx === undefined || m.dy === undefined ? [] : [{ name: m.name, dx: m.dx, dy: m.dy }]));
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
        // マップセットは続いて届く地図と一緒に地図の窓へ送る (ui/src/mapsetPending.ts)
        if (ev.mapset !== undefined || ev.mapsetDefine) {
          pendingMapsets.current.set(session, holdMapset(pendingMapsets.current.get(session), ev, s.defines));
          return;
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
    const now = performance.now();
    const how = ulistRequest(!!wait, lastUlist.current.get(session), now);
    if (how === "join") return void (then && wait?.thens.push(then));
    if (how === "skip") return then?.();
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
    if (!tabOf(session)?.privOpen) requestUlist(session);
    update(session, (t) => ({ ...t, privOpen: !t.privOpen }));
  }

  /** priv を送る。先に #ulist で番号を取り直す(Philly の PrivForm.cpp の SendPrivMessage) */
  async function sendPriv(session: number, to: string[], text: string): Promise<boolean> {
    const key = partnersKey(to);
    const conv = tabOf(session)?.privs.find((c) => partnersKey(c.to) === key);
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
      const t = tabOf(session);
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
    const tab = tabOf(session);
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
  /** 登録したキャラを開く。タブがあればそのタブへ移り、切れていれば同じタブで繋ぎ直す。無ければ接続する。
   * 一覧の「接続」からも同じにする。新しいタブを作ると、同じキャラのタブが二重に開いた (#133) */
  function openCharacter(label: string) {
    const target = characterTarget(tabsRef.current, label);
    if (target.kind === "connect") return void connect(label);
    setActive(target.session);
    if (target.kind === "reconnect") void connect(label, target.session);
  }

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
      fail(`${label}: ${e}`);
      return;
    }
    // 吹き出しと増減(ui/src/mapPop.ts)の為に、前の行から引き継ぐ物
    const popState = newPopState();
    handle = (ev) => {
      // タブを閉じた後と繋ぎ直した後は、前のセッションの分を捨てる。届いた地図や行で、消した物を入れ直していた (#163)
      if (forgotten.current.has(session)) return;
      if (ev.type === "status") {
        // 繋がったので、続けて繋ぎ直した回数を戻す。死んで繋ぎ直した時は、下がった最大 HP・MP を出す (#178)
        retries.current.delete(label);
        const before = beforeDeath.current.get(label);
        beforeDeath.current.delete(label);
        const loss = before && lossText(before, ev);
        if (loss) append(session, systemNg(loss));
      }
      switch (ev.type) {
        case "log":
          append(session, ev.html, ev.raw);
          if (ev.raw) {
            const plain = stripTags(ev.raw);
            if (DEAD_LINE.test(plain)) died.current.add(session);
            if (KICKED_LINE.test(plain)) kicked.current.add(session);
          }
          recentLines.current.set(session, [...(recentLines.current.get(session) ?? []), ev.raw ?? ""].slice(-2));
          signLine(signReads.current.get(session), ev.html);
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
          // 悪意のあるサーバが、任意のホストへキャラ ID を送らせない為(#51)。設定で確かめる様にした時だけ聞く
          if (!settingsRef.current.confirmTransfer) {
            invoke("send_line", { session, text: TRANSFER_YES }).catch(console.error);
            break;
          }
          {
            // 答えを待つ間に期限が切れたら (transferExpired)、窓を閉じる。開いたまま残っていた (#153)
            const expire = new AbortController();
            transferAsks.current.set(session, expire);
            confirmBox(
              `別のサーバ(${ev.host}:${ev.port})の世界へ移動します。\n移動先へキャラの ID を送ります。よろしいですか？`,
              expire.signal,
            )
              .then((ok) => {
                if (expire.signal.aborted) return;
                transferAsks.current.delete(session);
                return invoke("send_line", { session, text: ok ? TRANSFER_YES : TRANSFER_NO });
              })
              .catch(console.error);
          }
          break;
        }
        case "transferExpired":
          transferAsks.current.get(session)?.abort();
          transferAsks.current.delete(session);
          append(session, systemNg("世界移動の確かめに答えが無かったので、移動をやめました。"));
          break;
        case "sound":
          // Philly の SoundPlay。ファイルの無い規則はタスクバーの点滅
          if (!settingsRef.current.soundPlay) break;
          if (ev.file) new Audio(assetUrl("sound", { no: String(ev.no) })).play().catch(console.error);
          else getCurrentWindow().requestUserAttention(UserAttentionType.Informational).catch(console.error);
          break;
        case "connection": {
          // Philly と同じく、自分で切った時とサーバから切れた時で行を分ける(Character.cpp・PersonalThread.cpp)
          const mine = userClosing.current.delete(session);
          const wasOpen = !tabOf(session)?.closed;
          if (wasOpen)
            if (mine) append(session, systemOk("--- 切断しました ---"));
            else {
              // 1 行目は Philly と同じ文言 (docs/04-client-spec.md)。繋ぎ直し方は次の行に出す (#132)
              append(session, systemNg("サーバーから切断されました。"));
              append(session, systemNg("ファイルのメニューの「接続」で繋ぎ直せます。"));
            }
          update(session, (t) => ({ ...t, closed: true }));
          if (wasOpen) afterClosed(session, label, mine);
          // 切れたら、ついて行くのをやめる。裏のタブは切れたセッションへ go を送り続けた (#160)
          if (follows.current.has(session)) stopFollow(session, "切断したので、ついて行くのをやめました。");
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
          clearSpellWait(session);
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
          // 断られた理由 (bagMessage) は残す。まとめて送った途中の 1 行が断られても、後の一覧で消えない様に。
          // 消すのは次の操作を送る時 (sendBag)
          update(session, (t) => ({ ...t, bag: ev.items }));
          break;
        case "bagRefused":
          update(session, (t) => ({ ...t, bagMessage: BAG_REFUSED[ev.reason] ?? `出し入れ出来ません(${ev.reason})` }));
          break;
        case "mode": {
          // 看板などの本文(#more 〜 #end-more)は、ログに流すのに加えて札に出す(試験中)
          const { reading, card } = signMode(signReads.current.get(session), !!ev.more, recentLines.current.get(session) ?? []);
          if (reading) signReads.current.set(session, reading);
          else signReads.current.delete(session);
          if (card) update(session, (t) => ({ ...t, sign: card.lines, signAuthor: card.author }));
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
          const r = receiveList(listFlow(session), ev.active, ev.lines, tabOf(session)?.list);
          if (r === "close") closeList(session);
          else if (r) {
            // ゲートで行き先を選ぶ一覧が出た。仲間がどれを選んだかは分からないので、ついて行くのをやめる
            const f = follows.current.get(session);
            if (f) stopFollow(session, `${f.name} はゲートで移動しました。行き先を選んでください。`);
            // スムーズ移動で押し続けていても、ここで止める(stepWalker)
            if (session === activeRef.current && walking(session)) {
              walker.current.clear();
              walkHalted.current = true;
              trace("walk stop list");
            }
            update(session, (t) => ({ ...t, list: r }));
            onMapEvent(session, { ...ev, lines: r.lines });
            // 入力欄から打った命令でリストが出たら、ログへ移ってキーをリストの操作にする。
            // 入力欄のままだと番号が欄に入り、Enter で前の命令をもう一度送った。入力欄へは Tab で戻れる
            if (session === activeRef.current && document.activeElement?.classList.contains("input-line"))
              document.querySelector<HTMLElement>(".log-area .log-shown .phi-log")?.focus();
          }
          break;
        }
        case "moved": {
          if (session === activeRef.current && predictor.current.onMoved(ev.dx, ev.dy, ev.reason)) sendMapState(session);
          // 裏のタブでついて行く時、進めなかった返事 (0 0) なら地図は来ないので、ここで次を送れるようにする。
          // 進んだ時は、その後の地図が届くまで待つ (古い地図で次の 1 歩を決めない)
          const f = follows.current.get(session);
          if (f && ev.dx === 0 && ev.dy === 0) f.pending = undefined;
          break;
        }
        case "effect":
          // #v6 E。演出を当たった個体の位置に出す。名前で探すと、同じ名前の敵が並んだ時に別の個体に出た
          if (session === activeRef.current && settingsRef.current.mapEffects)
            emit(MAP_POP_EVENT, { pops: [], fx: [{ kind: ev.kind, from: ev.from, at: ev.at, element: ev.element, category: ev.category, wait: ev.wait }], to: mapPlace() }).catch(console.error);
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
        // ついて行く帯と詠唱の待ちも戻す。前のセッションのまま残り、帯が消えず、魔法の列が押せなかった (#160)
        ts.map((t) =>
          t.session === replace
            ? { ...t, session, closed: false, list: null, board: false, users: [], following: null, spellWaiting: false }
            : t,
        ),
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

  // 切れた時の繋ぎ直し (ui/src/reconnect.ts。#178 #179)。died と kicked は切れる前に届いた知らせ、
  // retries は表示名ごとの続けて自動で繋ぎ直した回数、beforeDeath は死ぬ前の最大 HP・MP
  const died = useRef(new Set<number>());
  const kicked = useRef(new Set<number>());
  const retries = useRef(new Map<string, number>());
  const beforeDeath = useRef(new Map<string, { maxHp?: number; maxMp?: number }>());
  function afterClosed(session: number, label: string, mine: boolean) {
    const next = afterClose(
      { mine, died: died.current.has(session), kicked: kicked.current.has(session) },
      retries.current.get(label) ?? 0,
    );
    // 繋ぎ直すのは、そのタブがまだ同じセッションで切れたままの時だけ (閉じた時と、手で繋ぎ直した時はしない)
    const stillClosed = () => tabsRef.current.some((t) => t.session === session && t.closed);
    if (next.kind === "ask-dead") {
      const st = mapStates.current.get(session)?.status;
      beforeDeath.current.set(label, { maxHp: st?.maxHp, maxMp: st?.maxMp });
      void confirmBox(`${label} は死亡しました。\n同じキャラで繋ぎ直しますか？`).then((ok) => {
        if (ok && stillClosed()) void connect(label, session);
      });
    } else if (next.kind === "retry") {
      retries.current.set(label, next.nth);
      append(session, systemOk(`${next.delay / 1000} 秒後に繋ぎ直します (${next.nth}/${RETRY_DELAYS.length})。`));
      window.setTimeout(() => {
        if (stillClosed()) void connect(label, session);
      }, next.delay);
    }
  }

  /** 閉じたか繋ぎ直したセッション。番号は使い回さないので、残しておく (数は接続した回数だけ) */
  const forgotten = useRef(new Set<number>());
  /** セッションごとに覚えた物を消す(#35)。セッションごとの Map を足したら、ここにも足す */
  function forgetSession(session: number) {
    forgotten.current.add(session);
    userClosing.current.delete(session);
    died.current.delete(session);
    kicked.current.delete(session);
    mapStates.current.delete(session);
    pendingMapsets.current.delete(session);
    clearSpellWait(session);
    listFlows.current.delete(session);
    lastUlist.current.delete(session);
    pendingLines.current.delete(session);
    signReads.current.delete(session);
    transferAsks.current.get(session)?.abort();
    transferAsks.current.delete(session);
    follows.current.delete(session);
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
        <div
          className={settings.modern ? "main-body modern" : settings.singleWindow ? "main-body single" : "main-body"}
          // ログの高さと幅は main-body に置き、魔法の列もログの幅を見て避ける (#169)
          style={
            settings.modern
              ? ({ "--log-h": `${logHeight}vh`, "--log-w": logWidth ? `${logWidth}px` : undefined } as React.CSSProperties)
              : undefined
          }
        >
        {settings.singleWindow && !settings.modern && mapPane && <MapPane />}
        {settings.modern && mapPane && (
          <div className="modern-map">
            <MapView embedded modern />
          </div>
        )}
        {settings.modern && boards}
        {tab.sign && <SignCard lines={tab.sign} author={tab.signAuthor ?? null} onClose={() => closeSign(tab.session)} />}
        {settings.modern && !tab.bagOpen && (
          <SpellBar
            spells={tab.spells ?? []}
            waiting={!!tab.spellWaiting}
            onCast={(sp) => castSpell(tab.session, sp)}
            onMove={(from, to) => moveSpellTile(tab.session, from, to)}
          />
        )}
        {tab.following && (
          <div className="follow-banner" role="status">
            {tab.following} について行っています
            <button type="button" onClick={() => stopFollow(tab.session)}>
              やめる
            </button>
          </div>
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
            following={tab.following ?? null}
            onFollow={(name) => (name ? startFollow(tab.session, name) : stopFollow(tab.session))}
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
            onPut={(slot) => sendBag(tab.session, `#ex-inv put ${slot}`)}
            onGet={(no) => sendBag(tab.session, `#ex-inv get ${no}`)}
            onDrop={(no, count) => sendBag(tab.session, `#ex-inv drop ${no} ${count}`)}
            onOffer={() => offer(tab.session)}
            onDropMany={(nos) => sendBag(tab.session, nos.map((no) => `#ex-inv drop ${no} 1`).join("\n"))}
            onGetMany={(nos) => sendBag(tab.session, nos.map((no) => `#ex-inv get ${no}`).join("\n"))}
            onUse={(no) => sendBag(tab.session, `#ex-inv use ${no}`)}
            onEquip={(no) => sendBag(tab.session, `#ex-inv equip ${no}`)}
            onDestroy={(items, names) =>
              void confirmBox(`次の物を捨てます。捨てた物は戻せません。\n${names}`).then(
                (ok) => ok && sendBag(tab.session, items.map(({ no, count }) => `#ex-inv destroy ${no} ${count}`).join("\n")),
              )
            }
            onSend={(text) => sendItemLines(tab.session, text)}
            onClose={() => update(tab.session, (t) => ({ ...t, bagOpen: false }))}
          />
        )}
        <div className={logMax && settings.modern ? "log-area log-max" : "log-area"}>
          {settings.modern && (
            <LogHeight value={logHeight} onChange={setLogHeight} max={!!logMax} onMax={() => setLogMax(logMax ? 0 : 1)} />
          )}
          {settings.modern && !logMax && <LogWidthHandle onChange={setLogWidth} />}
          <div
            className="log-menu-area"
            onContextMenu={(e) => {
              e.preventDefault();
              // 表に出しているログ (パーティのタブならパーティの行) から探す。全体の行から探すと、id が合わず空か別の行をコピーした (#161)
              setLogMenu({ x: e.clientX, y: e.clientY, lines: linesAt(tab.partyMode ? tab.partyLines : tab.lines, e.target as Element) });
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
              onSend={(text) => sendItemLines(tab.session, text)}
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
          onDownload={() => setDownloadOpen(true)}
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

/** 追尾移動で、続けて送る間隔の下限(ms)。サーバは 0.1 秒に1行ずつ処理する */
const FOLLOW_MS = 110;

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
  none: "ここで受け取ってもらえる物がありません",
  gp: "お金はカバンに入れられません。拾ってください",
  nobag: "この物はカバンに入れられません",
  store: "預かり所のマスでは置けません",
};

/** マップを main 窓に出すか(クラシック(1窓)とモダン) */
const inMain = (s: Settings) => s.singleWindow || s.modern;
