// priv の画面(Philly の PrivForm)。Philly と同じく相手の組ごとに窓を分ける。
// 窓は WPHI の窓の中に浮かべる(別の OS の窓だと、窓いっぱいの地図の後ろに回って見失う為)。
// 入力欄の上の priv のボタンでは、会話と相手を選ぶ欄(PrivLauncher)を開く
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { partnersKey, type User } from "./priv.ts";
import { LogLines } from "./LogLineList";
import type { LogLine } from "./logLines.ts";
import { Minus, MessagesSquare, X } from "lucide-react";

/**
 * confirm: 受けた priv の宛先のタグで作った3人以上の会話。初めて送る前に宛先を確かめる(#53)。
 * open は窓を出しているか、min は畳んでいるか。x・y は窓の左上(main 窓の本文の中の位置。無ければ既定の位置)、z は重なりの順
 */
export type PrivConv = {
  to: string[];
  lines: LogLine[];
  unread: boolean;
  confirm?: boolean;
  open?: boolean;
  min?: boolean;
  x?: number;
  y?: number;
  z?: number;
};

export const convLabel = (to: string[]) => to.join("・");

/** 会話と相手を選ぶ欄。会話を押すとその窓を開き、相手を選んで「選んだ相手と話す」で新しい会話の窓を開く */
export function PrivLauncher(props: {
  convs: PrivConv[];
  users: User[];
  self: string;
  onShow: (key: string) => void;
  onOpen: (to: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const others = props.users.filter((u) => u.name !== props.self);
  return (
    <div className="priv-panel">
      <div className="priv-head">
        <span>priv</span>
        <button title="閉じる" onClick={props.onClose}>
          <X />
        </button>
      </div>
      <div className="priv-convs">
        {props.convs.map((c) => {
          const key = partnersKey(c.to);
          return (
            <button key={key} className={c.unread ? "unread" : c.open ? "active" : undefined} onClick={() => props.onShow(key)}>
              {convLabel(c.to)}
            </button>
          );
        })}
      </div>
      <div className="priv-users">
        <div className="priv-users-list">
          {others.map((u) => (
            <label key={u.name}>
              <input
                type="checkbox"
                checked={picked.includes(u.name)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, u.name] : p.filter((n) => n !== u.name)))}
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
          <MessagesSquare />
          選んだ相手と話す
        </button>
      </div>
    </div>
  );
}

/** 窓の幅(CSS の .priv-window と同じ) */
const WIN_W = 300;

/** 相手の組 1 つの窓。見出しをドラッグして動かし、畳むと見出しだけにする */
export function PrivWindow(props: {
  conv: PrivConv;
  /** 既定の位置をずらす為の番号 */
  index: number;
  /** 送らなかった(宛先の確かめで断った)時は false。入力欄の文字を残す */
  onSend: (text: string) => Promise<boolean>;
  onFront: () => void;
  onMove: (x: number, y: number) => void;
  onMin: (min: boolean) => void;
  onClose: () => void;
}) {
  const { conv } = props;
  const box = useRef<HTMLDivElement>(null);
  // ドラッグ中の位置は窓の中だけで持ち、離した時に onMove で残す(動かす度に全体を描き直さない為)
  const [drag, setDrag] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const x = drag?.x ?? conv.x ?? null;
  const y = drag?.y ?? conv.y ?? 64 + props.index * 28;
  const style: React.CSSProperties = {
    top: y,
    zIndex: 10 + (conv.z ?? 0),
    // 既定の位置は右上の仲間の一覧 (.party-hud、幅 168px) の左。同じ所に出して一覧を隠していた (#170)
    ...(x === null ? { right: 16 + 168 + 8 + props.index * 28 } : { left: x }),
  };

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Esc でログへ移り、キーを移動などの操作に戻す (メインの入力欄と同じ)。priv の欄からは戻る手が無かった
    if (e.key === "Escape" && !e.nativeEvent.isComposing) {
      document.querySelector<HTMLElement>(".log-area .log-shown .phi-log")?.focus();
      return;
    }
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const text = e.currentTarget.value;
    if (text === "") return;
    const input = e.currentTarget;
    props.onSend(text).then((sent) => {
      if (sent && input.value === text) input.value = "";
    });
  }

  function onDown(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as Element).closest("button") || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const parent = box.current.offsetParent?.getBoundingClientRect();
    if (!parent) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x: r.left - parent.left, y: r.top - parent.top, dx: e.clientX - r.left, dy: e.clientY - r.top });
  }
  function onDrag(e: PointerEvent<HTMLDivElement>) {
    const parent = box.current?.offsetParent?.getBoundingClientRect();
    if (!drag || !parent) return;
    // 見出しが本文の外へ出て掴めなくならないようにする
    const nx = Math.min(Math.max(e.clientX - parent.left - drag.dx, 0), Math.max(parent.width - WIN_W, 0));
    const ny = Math.min(Math.max(e.clientY - parent.top - drag.dy, 0), Math.max(parent.height - 28, 0));
    setDrag({ ...drag, x: nx, y: ny });
  }
  function onUp() {
    if (drag) props.onMove(drag.x, drag.y);
    setDrag(null);
  }

  return (
    <div ref={box} className={conv.min ? "priv-window min" : "priv-window"} style={style} onPointerDown={props.onFront}>
      <div
        className={conv.unread ? "priv-window-head unread" : "priv-window-head"}
        onPointerDown={onDown}
        onPointerMove={onDrag}
        onPointerUp={onUp}
        onDoubleClick={() => props.onMin(!conv.min)}
      >
        <span title={convLabel(conv.to)}>{convLabel(conv.to)}</span>
        <button title={conv.min ? "広げる" : "畳む"} onClick={() => props.onMin(!conv.min)}>
          <Minus />
        </button>
        <button title="閉じる(会話は残る)" onClick={props.onClose}>
          <X />
        </button>
      </div>
      {!conv.min && (
        <>
          <div className="phi-log priv-log">
            <LogLines lines={conv.lines} />
          </div>
          <input className="priv-input" placeholder={`${convLabel(conv.to)} へ`} onKeyDown={onKeyDown} />
        </>
      )}
    </div>
  );
}
