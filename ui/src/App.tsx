import { Channel, invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { afterSend, caretLine, prepareLine } from "./chat.ts";
import { isTextTarget, KEY_EVENT, keyContext, runKeyAction, sendLine, type ForwardedKey } from "./keyInput";
import { keyAction, moveInput } from "./keys.ts";
import { MoveRepeat } from "./moveRepeat.ts";
import { MAP_STATE_EVENT, type MapState, type UiEvent } from "./protocol";

// src-tauri/src/characters.rs の Store
type Character = { label: string; host: string; port: number };
type Store = { characters: Character[]; openTabs: string[] };

type Tab = {
  session: number;
  label: string;
  /** ログ欄の HTML。1要素が1行 */
  lines: string[];
  closed: boolean;
};

/** Philly のログバッファに合わせ、古い行から捨てる */
const MAX_LINES = 2000;

function timePrefix(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `<font class="class_time">${hh}:${mm} </font>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
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
  const sendMapState = (session: number | null) => {
    const state = session === null ? undefined : mapStates.current.get(session);
    emitTo("map", MAP_STATE_EVENT, state ?? { session: -1, mapset: "" }).catch((e) => console.error(e));
  };
  useEffect(() => sendMapState(active), [active]);
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
  const mover = useRef<MoveRepeat | null>(null);
  useEffect(() => {
    if (active === null) {
      mover.current = null;
      return;
    }
    const session = active;
    mover.current = new MoveRepeat(
      (text) => sendLine(session, text),
      () => keyContext(mapStates.current.get(session)).northFix,
    );
    const timer = setInterval(() => mover.current?.tick(), 50);
    return () => clearInterval(timer);
  }, [active]);

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
    /** 操作にしたら true */
    const onKey = (e: ForwardedKey): boolean => {
      const session = activeRef.current;
      if (session === null) return false;
      if (e.type === "blur") {
        mover.current?.releaseAll();
        return false;
      }
      const ctx = keyContext(mapStates.current.get(session));
      const move = moveInput(e, ctx);
      if (move) {
        if (e.type === "keydown") mover.current?.keyDown(move.key, move.mods, e.repeat);
        else mover.current?.keyUp(move.key);
        return true;
      }
      if (e.type !== "keydown") return false;
      const action = keyAction(e, ctx);
      if (!action) return false;
      // 押し続けによる自動リピートは送らない
      if (!e.repeat) runKeyAction(action, session, { focusInput, nextTab });
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
    return () => {
      document.removeEventListener("keydown", onDom);
      document.removeEventListener("keyup", onDom);
      window.removeEventListener("blur", onBlur);
      forwarded.then((f) => f());
    };
  }, []);

  function onMapEvent(session: number, ev: UiEvent) {
    const s = mapStates.current.get(session) ?? { session, mapset: "" };
    switch (ev.type) {
      case "map":
        s.map = ev;
        if (session === activeRef.current) mover.current?.onMap();
        break;
      case "status":
        s.status = ev;
        break;
      case "cond":
        s.cond = ev;
        break;
      case "mode":
        s.mode = ev;
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

  const update = (session: number, f: (t: Tab) => Tab) =>
    setTabs((ts) => ts.map((t) => (t.session === session ? f(t) : t)));

  const append = (session: number, html: string) =>
    update(session, (t) => ({ ...t, lines: [...t.lines, timePrefix() + html].slice(-MAX_LINES) }));

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
          // リピート移動中に壁に当たった時(Philly の PersonalThread.cpp の RecvCannotGo)
          if (session === activeRef.current && /DM<\/font> &gt; (進めません\.|Can not go\.)/.test(ev.html))
            mover.current?.onCannotGo();
          break;
        case "error":
          append(session, systemNg(ev.message));
          break;
        case "connection":
          update(session, (t) => ({ ...t, closed: true }));
          break;
        default:
          onMapEvent(session, ev);
      }
    };
    setTabs((ts) => [...ts, { session, label, lines: [], closed: false }]);
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
      <style>{logCss}</style>
      <TabBar tabs={tabs} active={active} onSelect={setActive} onClose={close} />
      {tab ? (
        <LogView key={tab.session} lines={tab.lines} />
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
}) {
  return (
    <div className="tab-bar">
      {props.tabs.map((t) => (
        <span key={t.session} className={t.session === props.active ? "tab active" : "tab"}>
          <button className="tab-label" onClick={() => props.onSelect(t.session)}>
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
    </div>
  );
}

function LogView(props: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);

  // 末尾を表示している時だけ追従する
  const atBottom = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [props.lines]);

  // リンクで WebView を遷移させず、既定のブラウザで開く
  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href");
    if (href && /^https?:\/\//.test(href)) openUrl(href);
  }

  return (
    <div
      ref={ref}
      className="phi-log"
      // フォーカスを受けると「移動モード」になり、キーが操作になる
      tabIndex={0}
      onClick={onClick}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
      }}
    >
      {props.lines.map((html, i) => (
        // html は phi-proto の tag_to_html がエスケープ済みで作ったもの
        <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
      ))}
    </div>
  );
}

/**
 * 入力欄(Philly の InputEdit)。Philly と同じ複数行のエディタで、Enter はカーソルの行を送り、送った行は欄に残す。
 * Ctrl+Enter はパーティー発言、Shift+Enter は改行。
 * value を React に持たせない。ログが届くたびの再描画で value を書き戻すと、WebKitGTK が変換中の文字を消す
 */
function InputEditor(props: { session: number; sessions: number[]; disabled: boolean }) {
  const [loud, setLoud] = useState(false);
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
    if (loud && !allTab) {
      // Philly は大声の前に確認し、送ったら大声を解除する
      if (!window.confirm("大声で発言します。\nこの世界にいる全員に聞こえます。\nよろしいですか？")) {
        setLoud(false);
        return;
      }
      setLoud(false);
    }
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
      <div className="input-toolbar">
        <label className={loud ? "toggle on" : "toggle"}>
          <input type="checkbox" checked={loud} onChange={(e) => setLoud(e.target.checked)} />
          大声
        </label>
        <label className={allTab ? "toggle on" : "toggle"}>
          <input type="checkbox" checked={allTab} onChange={(e) => setAllTab(e.target.checked)} />
          全タブ発言
        </label>
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
    </div>
  );
}
