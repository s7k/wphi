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

  async function get(list: Row[]) {
    try {
      for (const r of list) {
        setBusy(r.id);
        setMessage(`${r.title} を取得しています...`);
        const n = await invoke<number>("download_item", { id: r.id });
        setMessage(`${r.title} を取得しました(${n} 個のファイル)。`);
        await load();
      }
      if (list.length > 1) setMessage(`${list.length} 個を取得しました。`);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(null);
    }
  }
  // 取得していない物と、新しい版がある物
  const stale = rows.filter((r) => r.got !== r.date);

  return (
    <div className="settings-panel">
      <div className="board-title">キャラグラとマップチップを取得する</div>
      <div className="settings-body">
        <p>配布元から取得して、設定フォルダの data に置きます。取得した画像はすぐに使います。</p>
        <div>
          <button disabled={busy !== null || stale.length === 0} onClick={() => get(stale)}>
            全部取得する
          </button>{" "}
          {stale.length === 0 && rows.length > 0 ? "全部取得済みです。" : ""}
        </div>
        <table className="download-list">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td title={r.url}>{r.title}</td>
                <td>{r.got === null ? "" : r.got === r.date ? "取得済み" : "新しい版があります"}</td>
                <td>
                  <button disabled={busy !== null} onClick={() => get([r])}>
                    {busy === r.id ? "取得しています" : r.got === null ? "取得する" : "取得し直す"}
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
