import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

// src-tauri/src/session.rs の UiEvent。P1 では使う項目だけを型にする
type UiEvent =
  | { type: "log"; channel: string; html: string; from?: string }
  | { type: "error"; message: string }
  | { type: "notice"; name?: string; world?: string; area?: string; mapset?: string }
  | { type: "connection"; state: "closed" }
  | { type: string };

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

/** Log.css は Philly では IE の別文書に当てていた。body をログ欄に読み替えて使う */
function scopeLogCss(css: string): string {
  return css.replace(/(^|[\s,}])body(?=[\s,{])/g, "$1.phi-log");
}

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [logCss, setLogCss] = useState("");

  useEffect(() => {
    invoke<string>("log_css")
      .then((css) => setLogCss(scopeLogCss(css)))
      .catch((e) => console.error(e));
  }, []);

  const update = (session: number, f: (t: Tab) => Tab) =>
    setTabs((ts) => ts.map((t) => (t.session === session ? f(t) : t)));

  const append = (session: number, html: string) =>
    update(session, (t) => ({ ...t, lines: [...t.lines, timePrefix() + html].slice(-MAX_LINES) }));

  async function connect(host: string, port: number, id: string) {
    const channel = new Channel<UiEvent>();
    const session = await invoke<number>("connect", { host, port, id, onEvent: channel });
    channel.onmessage = (ev) => {
      switch (ev.type) {
        case "log":
          append(session, (ev as { html: string }).html);
          break;
        case "error":
          append(session, `<font class="class_system_ng">${escapeHtml((ev as { message: string }).message)}</font>`);
          break;
        case "notice": {
          const name = (ev as { name?: string }).name;
          if (name) update(session, (t) => ({ ...t, label: name }));
          break;
        }
        case "connection":
          update(session, (t) => ({ ...t, closed: true }));
          break;
      }
    };
    setTabs((ts) => [...ts, { session, label: `${host}:${port}`, lines: [], closed: false }]);
    setActive(session);
  }

  const tab = tabs.find((t) => t.session === active);

  return (
    <div className="main">
      <style>{logCss}</style>
      <TabBar tabs={tabs} active={active} onSelect={setActive} />
      {tab ? <LogView key={tab.session} lines={tab.lines} /> : <ConnectForm onConnect={connect} />}
      {tab && <InputLine session={tab.session} disabled={tab.closed} />}
      <div className="status-bar">{tab ? (tab.closed ? "切断" : "接続中") : "未接続"}</div>
    </div>
  );
}

function TabBar(props: { tabs: Tab[]; active: number | null; onSelect: (s: number | null) => void }) {
  return (
    <div className="tab-bar">
      {props.tabs.map((t) => (
        <button
          key={t.session}
          className={t.session === props.active ? "tab active" : "tab"}
          onClick={() => props.onSelect(t.session)}
        >
          {t.label}
        </button>
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

function InputLine(props: { session: number; disabled: boolean }) {
  const [text, setText] = useState("");

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // IME の変換確定の Enter では送らない
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    invoke("send_line", { session: props.session, text }).catch((err) => console.error(err));
    setText("");
  }

  return (
    <input
      className="input-line"
      value={text}
      disabled={props.disabled}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKeyDown}
      autoFocus
    />
  );
}

function ConnectForm(props: { onConnect: (host: string, port: number, id: string) => void }) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [id, setId] = useState("");

  return (
    <form
      className="connect-form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onConnect(host, Number(port), id);
      }}
    >
      <label>
        サーバ <input value={host} onChange={(e) => setHost(e.target.value)} required />
      </label>
      <label>
        ポート <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" required />
      </label>
      <label>
        キャラ ID <input type="password" value={id} onChange={(e) => setId(e.target.value)} required />
      </label>
      <button type="submit">接続</button>
    </form>
  );
}
