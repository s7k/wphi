import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

// src-tauri/src/session.rs の UiEvent。P1 では使う項目だけを型にする
type UiEvent =
  | { type: "log"; channel: string; html: string; from?: string }
  | { type: "error"; message: string }
  | { type: "connection"; state: "closed" }
  | { type: string };

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
          append(session, (ev as { html: string }).html);
          break;
        case "error":
          append(session, systemNg((ev as { message: string }).message));
          break;
        case "connection":
          update(session, (t) => ({ ...t, closed: true }));
          break;
      }
    };
    setTabs((ts) => [...ts, { session, label, lines: [], closed: false }]);
    setActive(session);
  }

  function close(session: number) {
    invoke("disconnect", { session }).catch((e) => console.error(e));
    setTabs((ts) => ts.filter((t) => t.session !== session));
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
      {tab && <InputLine session={tab.session} disabled={tab.closed} />}
      <div className="status-bar">{tab ? (tab.closed ? "切断" : "接続中") : "キャラ選択"}</div>
    </div>
  );
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
  // value を React に持たせない。ログが届くたびの再描画で value を書き戻すと、WebKitGTK が変換中の文字を消す
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // IME の変換確定の Enter では送らない。WebKit は確定の keydown で isComposing を false にし、keyCode 229 を返す
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const input = e.currentTarget;
    invoke("send_line", { session: props.session, text: input.value }).catch((err) => console.error(err));
    input.value = "";
  }

  return <input className="input-line" disabled={props.disabled} onKeyDown={onKeyDown} autoFocus />;
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
