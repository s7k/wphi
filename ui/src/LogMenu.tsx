// ログ欄の右クリックメニュー(Philly の MainForm.dfm の PopupMenu)。#81
// 選んだ行(選んでいなければ押した行)を、設定のコピーの仕方でコピー・発言欄へ・発言する。
import { useEffect } from "react";
import { copyText, type CopyOptions } from "./logCopy.ts";
import type { LogLine } from "./logLines.ts";
import type { Settings } from "./settings.ts";

export type LogMenuAt = { x: number; y: number; lines: LogLine[] };

/** チェックで切り替えるコピーの設定 */
const TOGGLES: [keyof Settings, string][] = [
  ["logTagDeleteCopy", "コピーでタグを除く"],
  ["logTagDeleteAlways", "発言欄にコピー・発言する時もタグを除く"],
  ["logTimeDelete", "時刻を除く"],
  ["logNameDelete", "名前を除く"],
  ["logTagCancel", "タグを無効にする(/* → /＊)"],
];

export function LogMenu(props: {
  at: LogMenuAt;
  settings: Settings;
  onCopy: (text: string) => void;
  onToInput: (text: string) => void;
  onSend: (text: string) => void;
  onShow: (text: string) => void;
  onToggle: (key: keyof Settings) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => props.onClose();
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  });
  const s = props.settings;
  const text = (deleteTags: boolean) =>
    copyText(props.at.lines, {
      deleteTags,
      deleteTime: s.logTimeDelete,
      deleteName: s.logNameDelete,
      cancelTags: s.logTagCancel,
    });
  const has = props.at.lines.length > 0;
  const item = (label: string, run: () => void, enabled = has) => (
    <li className={enabled ? undefined : "disabled"} onClick={enabled ? run : undefined}>
      {label}
    </li>
  );
  return (
    <ul className="tag-menu" style={{ left: props.at.x, top: props.at.y }}>
      {item("コピー", () => props.onCopy(text(s.logTagDeleteCopy || s.logTagDeleteAlways)))}
      {item("タグ付きでコピー", () => props.onCopy(text(false)))}
      {item("タグ無しでコピー", () => props.onCopy(text(true)))}
      <li className="separator" />
      {item("発言欄にコピー", () => props.onToInput(text(s.logTagDeleteAlways)))}
      {item("発言する", () => props.onSend(text(s.logTagDeleteAlways)))}
      {item("タグを表示する", () => props.onShow(text(false)))}
      <li className="separator" />
      {TOGGLES.map(([key, label]) => (
        <li key={key} onClick={() => props.onToggle(key)}>
          <span className="menu-check">{s[key] ? "✓" : ""}</span>
          {label}
        </li>
      ))}
    </ul>
  );
}
