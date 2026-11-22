import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { confirmBox } from "./MessageDialog";
import { NewCharacter, WorldSelect } from "./NewCharacter";
import { Download, Import, Plug, Trash2, UserPlus } from "lucide-react";
import type { Store } from "./App";

export function CharacterList(props: {
  store: Store;
  error: string;
  onConnect: (label: string) => void;
  onChanged: () => void;
  onError: (message: string) => void;
  onDownload: () => void;
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

      {props.store.characters.length === 0 && (
        // 初めて開いた時の案内。新規作成が一番下にあり、キャラグラの取得も案内していなかった (#171)
        <div className="first-run">
          <p>はじめての方は「新規キャラ作成」で、Philly を使っていた方は「Philly から取り込む」でキャラを登録してください。</p>
          <p>
            キャラグラとマップチップは、世界ごとに取得します。
            <button type="button" onClick={props.onDownload}>
              <Download />
              キャラグラとマップチップを取得する
            </button>
          </p>
        </div>
      )}
      <NewCharacter onCreated={props.onChanged} onError={props.onError} />
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
          {/* 一覧に無い表示名は新しいキャラなので、ID を要る (#152) */}
          <input
            type="password"
            value={id}
            onChange={(e) => setId(e.target.value)}
            required={!props.store.characters.some((c) => c.label === label)}
          />
        </label>
        <button type="submit">
          <UserPlus />
          登録
        </button>
      </form>

    </div>
  );
}
