// 設定画面(Philly は Philly.ini を直接書き換える)。
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { COPY_TOGGLES } from "./LogMenu";
import { confirmBox } from "./MessageDialog";
import { changedKeys, clampZoom, HUD_STATS, MAP_ZOOMS, mergeChanged, type Settings } from "./settings.ts";
import { Import, Save, X } from "lucide-react";

/** 歩き出しの重さの段の名前 (walker.ts の WEIGHTS) */
const WEIGHT_LABEL: Record<number, string> = { [-2]: "とても軽い", [-1]: "軽い", 0: "標準", 1: "重い", 2: "とても重い" };

export function SettingsPanel(props: { settings: Settings; onSaved: (s: Settings) => void; onClose: () => void }) {
  const [s, setS] = useState(props.settings);
  // 開いた時か保存した時の値。変えた項目を見分け、保存の時にそれだけを今の設定に重ねる。
  // 写しを丸ごと保存すると、開いている間に表示メニューで変えた値を元に戻した (#138)
  const [base, setBase] = useState(props.settings);
  const [message, setMessage] = useState("");
  const changed = changedKeys(base, s);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));
  const setAt = (k: "shortcuts" | "listShortcuts", i: number, v: string) =>
    setS((p) => ({ ...p, [k]: p[k].map((x, j) => (j === i ? v : x)) }));

  async function save(edited: Settings) {
    try {
      let next = mergeChanged(props.settings, edited, changed);
      next = { ...next, mapZoom: clampZoom(next.mapZoom), mapZoomM57: clampZoom(next.mapZoomM57 || next.mapZoom) };
      setS(next);
      setBase(next);
      await invoke("save_settings", { settings: next });
      props.onSaved(next);
      setMessage("保存しました");
    } catch (e) {
      setMessage(String(e));
    }
  }

  /** 保存していない変更があれば、捨ててよいか確かめてから閉じる (#138) */
  function close() {
    if (changed.length === 0) return props.onClose();
    void confirmBox("保存していない変更があります。\n保存せずに閉じますか？").then((ok) => ok && props.onClose());
  }
  return (
    // キーを Philly の操作にしない (AskDialog と同じ)。開いている間に Space で攻撃したり矢印で歩いたりした。
    // Esc は他の画面 (札・カバン) と同じく閉じる
    <div
      className="settings-panel"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !e.nativeEvent.isComposing && !document.querySelector(".ask-backdrop")) close();
      }}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="board-title">設定</div>
      <div className="settings-body">
        {/* 見出しで分ける。一列に並べていた為、目的の項目を探すのに全部読む必要があった (#173) */}
        <fieldset className="settings-group">
          <legend>接続</legend>
          <label>
            <input type="checkbox" checked={s.autoConnect} onChange={(e) => set("autoConnect", e.target.checked)} />
            起動した時に、前回開いていたタブのキャラへ自動で接続する
          </label>
          <label>
            <input type="checkbox" checked={s.confirmTransfer} onChange={(e) => set("confirmTransfer", e.target.checked)} />
            別のサーバ(違うアドレスかポート)の世界へ移る時に、キャラの ID を送ってよいか確かめる(オフだと確かめずに移った先のサーバへ ID を渡す)
          </label>
        </fieldset>
        <fieldset className="settings-group">
          <legend>移動</legend>
          <label>
            <input type="checkbox" checked={s.smoothMove} onChange={(e) => set("smoothMove", e.target.checked)} />
            スムーズ移動(押している間、地図を滑らかに動かして歩く。v6 のサーバで北固定の地図の時)
          </label>
          <label className="settings-range">
            歩き出し 軽い{" "}
            <input
              type="range"
              min={-2}
              max={2}
              step={1}
              value={s.smoothWeight}
              disabled={!s.smoothMove}
              onChange={(e) => set("smoothWeight", Number(e.target.value))}
            />{" "}
            重い({WEIGHT_LABEL[s.smoothWeight] ?? "標準"})
          </label>
          <p className="settings-note">
            重くすると、歩き出しがゆっくりになり、軽く押した時に少しだけ進みます。軽くすると、歩き出しが速くなり、軽く押しても多く進みます。
            押し続けた時の速さはどれも同じです。真ん中が標準です。
          </p>
          <label>
            <input type="checkbox" checked={s.fullKeyMove} onChange={(e) => set("fullKeyMove", e.target.checked)} />
            フルキーの 789 uio jkl m を移動に、- ; / ' を置く・拾う・装備・使うに使う(フルキー移動。テンキーと同じ)
          </label>
        </fieldset>
        <fieldset className="settings-group">
          <legend>画面</legend>
          <div className="settings-hud">
            <span>モダンの画面の左上に出すステータス</span>
            {HUD_STATS.map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={s.hudStats.includes(key)}
                  onChange={(e) =>
                    set(
                      "hudStats",
                      HUD_STATS.map(([k]) => k).filter((k) => (k === key ? e.target.checked : s.hudStats.includes(k))),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label>
            地図の拡大率 v6 の地図{" "}
            <select value={clampZoom(s.mapZoom)} onChange={(e) => set("mapZoom", Number(e.target.value))}>
              {MAP_ZOOMS.map((z) => (
                <option key={z} value={z}>
                  {z}%
                </option>
              ))}
            </select>{" "}
            7x7 の地図(v5y など){" "}
            <select value={clampZoom(s.mapZoomM57 || s.mapZoom)} onChange={(e) => set("mapZoomM57", Number(e.target.value))}>
              {MAP_ZOOMS.map((z) => (
                <option key={z} value={z}>
                  {z}%
                </option>
              ))}
            </select>{" "}
            (ドットが崩れない整数倍だけ。拡大すると、v6 のサーバで見える範囲は狭くなる)
          </label>
          {/* 画面の形などは表示メニューにだけあり、ここを探して見つからなかった (#137) */}
          <p className="settings-note">
            画面の形(モダン・クラシック)、吹き出しの演出、木と草の揺らぎは、メニューの「表示」で切り替えます。
          </p>
          <label>
            <input type="checkbox" checked={s.taskBarFlash} onChange={(e) => set("taskBarFlash", e.target.checked)} />
            発言と priv が届いた時に、タスクバーを点滅させる
          </label>
        </fieldset>
        <fieldset className="settings-group">
          <legend>ログ</legend>
          <label>
            <input type="checkbox" checked={s.logSaveHtml} onChange={(e) => set("logSaveHtml", e.target.checked)} />
            ログを HTML で保存する(オフならテキスト)
          </label>
          <label>
            <input type="checkbox" checked={s.logDispTime} onChange={(e) => set("logDispTime", e.target.checked)} />
            ログの行頭に時刻を出す(保存するログには、オフでも時刻を入れる)
          </label>
          <label>
            ログのフォント{" "}
            <input
              value={s.logFontName}
              placeholder="空なら既定のフォント"
              onChange={(e) => set("logFontName", e.target.value)}
            />
          </label>
          <label>
            ログの文字の大きさ{" "}
            <input
              type="number"
              min={0}
              max={64}
              value={s.logFontSize}
              onChange={(e) => set("logFontSize", Math.max(0, Math.min(64, Math.round(Number(e.target.value) || 0))))}
            />{" "}
            px(0 ならスキンの大きさ)
          </label>
          <label>
            <input type="checkbox" checked={s.soundPlay} onChange={(e) => set("soundPlay", e.target.checked)} />
            決まった言葉がログに出たら効果音を鳴らす(Philly の SoundRegexp.ini と SoundFile.ini を使う)
          </label>
          {/* ログのコピーの設定は右クリックのメニューにしか無かった (#173) */}
          <div className="settings-hud">
            <span>ログの右クリックのコピー</span>
            {COPY_TOGGLES.map(([key, label]) => (
              <label key={key}>
                <input type="checkbox" checked={!!s[key]} onChange={(e) => set(key, e.target.checked as never)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="settings-group">
          <legend>戦闘</legend>
          <label>
            自動攻撃を止める自分の HP{" "}
            <input
              type="number"
              min={0}
              max={90}
              value={s.autoStopHp}
              onChange={(e) => set("autoStopHp", Math.max(0, Math.min(90, Math.round(Number(e.target.value) || 0))))}
            />{" "}
            % 未満 (0 なら止めない)
          </label>
          <label>
            キーもマウスも触らない時間が{" "}
            <input
              type="number"
              min={0}
              max={120}
              value={s.autoStopIdleMin}
              onChange={(e) => set("autoStopIdleMin", Math.max(0, Math.min(120, Math.round(Number(e.target.value) || 0))))}
            />{" "}
            分を超えたら自動攻撃を止める (0 なら止めない)
          </label>
          <label>
            <input type="checkbox" checked={s.autoSkipLowKarma} onChange={(e) => set("autoSkipLowKarma", e.target.checked)} />
            自動攻撃と Shift+G の対象に、カルマの低い NPC (町の人など) を入れない
          </label>
        </fieldset>
        <fieldset className="settings-group">
          <legend>魔法</legend>
          <label>
            <input
              type="checkbox"
              checked={s.autoUnequipSystemMagic}
              onChange={(e) => set("autoUnequipSystemMagic", e.target.checked)}
            />
            系統魔法(Alt と Shift+Alt の魔法)の前に武器を外す
          </label>
          <label>
            <input
              type="checkbox"
              checked={s.autoEquipSystemMagic}
              disabled={!s.autoUnequipSystemMagic}
              onChange={(e) => set("autoEquipSystemMagic", e.target.checked)}
            />
            系統魔法の後に、外した武器を装備し直す(チャット場ではオフを勧める)
          </label>
          <label>
            <input type="checkbox" checked={s.masterMagicMenu} onChange={(e) => set("masterMagicMenu", e.target.checked)} />
            超魔法メニューを、マスターでなくても出す(サーバの権限ファイルでマスターになった時)
          </label>
        </fieldset>
        <fieldset className="settings-group">
          <legend>キー</legend>
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
        </fieldset>
        {message && <p>{message}</p>}
      </div>
      <div className="board-buttons">
        <button onClick={() => save(s)}>
          <Save />
          保存
        </button>
        <button
          onClick={async () => {
            // 取り込みはすぐ保存するので、編集中の値を捨ててよいか確かめる。確かめずに上書きしていた (#168)
            if (changed.length > 0 && !(await confirmBox("保存していない変更は捨てます。\nPhilly.ini から取り込みますか？"))) return;
            invoke<Settings>("import_philly_settings")
              .then((next) => {
                setS(next);
                setBase(next);
                props.onSaved(next);
                setMessage("Philly.ini から取り込んで保存しました");
              })
              .catch((e) => setMessage(String(e)));
          }}
        >
          <Import />
          Philly.ini から取り込んで保存
        </button>
        <button onClick={close}>
          <X />
          閉じる
        </button>
      </div>
    </div>
  );
}
