// 新規キャラ作成(Philly では別プログラムの PhillyNewCharacter.exe)。
// 作ったキャラはそのまま一覧に入り、ID は設定フォルダの .phirc に置く。
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { assetUrl } from "./asset";

/** パスワードを省いた時に決める6字(英小文字と数字) */
function randomPass(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

export function NewCharacter(props: { onCreated: () => void; onError: (message: string) => void }) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [graphics, setGraphics] = useState<string[] | null>(null);
  const [image, setImage] = useState(0);
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [mail, setMail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  async function loadGraphics() {
    setBusy(true);
    try {
      setGraphics(await invoke<string[]>("register_graphics", { host, port: Number(port) }));
      setImage(0);
    } catch (e) {
      props.onError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const password = pass || randomPass();
    setBusy(true);
    try {
      const label = await invoke<string>("register_character", {
        host,
        port: Number(port),
        name,
        pass: password,
        image,
        mail,
      });
      setDone(`「${label}」を作って一覧に入れました。パスワードは ${password} です。`);
      setName("");
      setPass("");
      props.onCreated();
    } catch (e) {
      props.onError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (graphics) create();
        else loadGraphics();
      }}
    >
      <h3>新規キャラ作成</h3>
      <label>
        サーバ <input
          value={host}
          onChange={(e) => {
            // グラの一覧はサーバごとに違うので、サーバを変えたら読み直す(#69)
            setHost(e.target.value);
            setGraphics(null);
          }}
          required
        />
      </label>
      <label>
        ポート <input
          value={port}
          onChange={(e) => {
            setPort(e.target.value);
            setGraphics(null);
          }}
          inputMode="numeric"
          required
        />
      </label>
      {graphics === null ? (
        <button type="submit" disabled={busy}>
          キャラグラの一覧を読む
        </button>
      ) : (
        <>
          <div className="gra-picker">
            {graphics.map((g, i) => (
              <button
                type="button"
                key={g + i}
                className={i === image ? "gra selected" : "gra"}
                title={g}
                onClick={() => setImage(i)}
              >
                {/* 正面の大きい絵(96×160 の右側、F の行) */}
                <span style={{ backgroundImage: `url("${assetUrl("chara", { gra: g, code: "64" })}")` }} />
              </button>
            ))}
          </div>
          <label>
            名前(2文字以上) <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </label>
          <label>
            パスワード(6文字。空欄なら自動で決める)
            <input value={pass} onChange={(e) => setPass(e.target.value)} maxLength={6} />
          </label>
          <label>
            メール(省略可) <input value={mail} onChange={(e) => setMail(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            作る
          </button>
        </>
      )}
      {done && <p>{done}</p>}
    </form>
  );
}
