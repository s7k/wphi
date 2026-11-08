// 設定画面(Philly は Philly.ini を直接書き換える)。
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { Settings } from "./settings.ts";

export function SettingsPanel(props: { settings: Settings; onSaved: (s: Settings) => void; onClose: () => void }) {
  const [s, setS] = useState(props.settings);
  const [message, setMessage] = useState("");
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));
  const setAt = (k: "shortcuts" | "listShortcuts", i: number, v: string) =>
    setS((p) => ({ ...p, [k]: p[k].map((x, j) => (j === i ? v : x)) }));

  async function save(next: Settings) {
    try {
      await invoke("save_settings", { settings: next });
      props.onSaved(next);
      setMessage("保存しました");
    } catch (e) {
      setMessage(String(e));
    }
  }

  return (
    <div className="settings-panel">
      <div className="board-title">設定</div>
      <div className="settings-body">
        <label>
          <input type="checkbox" checked={s.fullKeyMove} onChange={(e) => set("fullKeyMove", e.target.checked)} />
          フルキーの 789 uio jkl m をテンキーとして使う(フルキー移動)
        </label>
        <label>
          <input type="checkbox" checked={s.soundPlay} onChange={(e) => set("soundPlay", e.target.checked)} />
          ログに出てきた文字列で効果音を鳴らす(Philly の Config/SoundRegexp.ini と SoundFile.ini)
        </label>
        <label>
          <input type="checkbox" checked={s.logSaveHtml} onChange={(e) => set("logSaveHtml", e.target.checked)} />
          ログを HTML で保存する(off ならテキスト)
        </label>
        <table>
          <thead>
            <tr>
              <th>キー</th>
              <th>送る文字列(\n で改行)</th>
              <th>リスト表示中</th>
            </tr>
          </thead>
          <tbody>
            {s.shortcuts.map((v, i) => (
              <tr key={i}>
                <td>F{i + 8}</td>
                <td>
                  <input value={v} onChange={(e) => setAt("shortcuts", i, e.target.value)} />
                </td>
                <td>
                  <input value={s.listShortcuts[i]} onChange={(e) => setAt("listShortcuts", i, e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <label>
          Alt+G で送る言葉 <input value={s.altGWord} onChange={(e) => set("altGWord", e.target.value)} />
        </label>
        {message && <p>{message}</p>}
      </div>
      <div className="board-buttons">
        <button onClick={() => save(s)}>保存</button>
        <button
          onClick={() =>
            invoke<Settings>("import_philly_settings")
              .then((next) => {
                setS(next);
                props.onSaved(next);
                setMessage("Philly.ini から取り込んで保存しました");
              })
              .catch((e) => setMessage(String(e)))
          }
        >
          Philly.ini から取り込む
        </button>
        <button onClick={props.onClose}>閉じる</button>
      </div>
    </div>
  );
}
