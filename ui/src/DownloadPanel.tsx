// キャラグラ・マップチップ・新規接続の設定のダウンロード(Raphi の unew.ini。download.rs)。
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type Row = { id: string; title: string; url: string; dir: string; date: string; got: string | null };

export function DownloadPanel(props: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const load = () => invoke<Row[]>("download_items").then(setRows).catch((e) => setMessage(String(e)));
  useEffect(() => void load(), []);

  async function get(r: Row) {
    setBusy(r.id);
    setMessage(`${r.title} を取っています...`);
    try {
      const n = await invoke<number>("download_item", { id: r.id });
      setMessage(`${r.title} を取りました(${n} 個のファイル)。`);
      await load();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="settings-panel">
      <div className="board-title">キャラグラとマップチップを取る</div>
      <div className="settings-body">
        <p>配布元から取って、設定フォルダの data に置きます。取った画像はすぐに使います。</p>
        <table className="download-list">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td title={r.url}>{r.title}</td>
                <td>{r.got === null ? "" : r.got === r.date ? "取得済み" : "新しい版があります"}</td>
                <td>
                  <button disabled={busy !== null} onClick={() => get(r)}>
                    {busy === r.id ? "取っています" : r.got === null ? "取る" : "取り直す"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>{message}</div>
      </div>
      <div className="board-buttons">
        <button onClick={props.onClose} disabled={busy !== null}>
          閉じる
        </button>
      </div>
    </div>
  );
}
