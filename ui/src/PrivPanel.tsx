// priv の画面(Philly の PrivForm)。相手の組ごとに会話を分ける。
// Philly は相手ごとに別窓を開くが、窓の配置は P4 で決めるので、今は main 窓の右に置く。
import { useState, type KeyboardEvent } from "react";
import { partnersKey, type User } from "./priv.ts";
import { LogLines } from "./LogLineList";
import type { LogLine } from "./logLines.ts";

export type PrivConv = { to: string[]; lines: LogLine[]; unread: boolean };

export function PrivPanel(props: {
  convs: PrivConv[];
  active: string | null;
  users: User[];
  self: string;
  onSelect: (key: string) => void;
  onOpen: (to: string[]) => void;
  onSend: (to: string[], text: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const conv = props.convs.find((c) => partnersKey(c.to) === props.active);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229 || !conv) return;
    e.preventDefault();
    const text = e.currentTarget.value;
    if (text === "") return;
    props.onSend(conv.to, text);
    e.currentTarget.value = "";
  }

  const others = props.users.filter((u) => u.name !== props.self);
  return (
    <div className="priv-panel">
      <div className="priv-head">
        <span>priv</span>
        <button onClick={props.onClose}>×</button>
      </div>
      <div className="priv-convs">
        {props.convs.map((c) => {
          const key = partnersKey(c.to);
          return (
            <button
              key={key}
              className={key === props.active ? "active" : c.unread ? "unread" : undefined}
              onClick={() => props.onSelect(key)}
            >
              {c.to.join("・")}
            </button>
          );
        })}
      </div>
      <div className="phi-log priv-log">
        {conv && <LogLines lines={conv.lines} />}
      </div>
      <input
        className="priv-input"
        placeholder={conv ? `${conv.to.join("・")} へ` : "下の一覧から相手を選ぶ"}
        disabled={!conv}
        onKeyDown={onKeyDown}
      />
      <div className="priv-users">
        <div className="priv-users-list">
          {others.map((u) => (
            <label key={u.name}>
              <input
                type="checkbox"
                checked={picked.includes(u.name)}
                onChange={(e) =>
                  setPicked((p) => (e.target.checked ? [...p, u.name] : p.filter((n) => n !== u.name)))
                }
              />
              {u.name}
            </label>
          ))}
        </div>
        <button
          disabled={picked.length === 0}
          onClick={() => {
            props.onOpen(picked);
            setPicked([]);
          }}
        >
          選んだ相手と話す
        </button>
      </div>
    </div>
  );
}
