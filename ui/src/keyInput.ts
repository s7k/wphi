import { invoke } from "@tauri-apps/api/core";
import type { KeyAction, KeyContext, MoveKey } from "./keys.ts";
import type { MapState } from "./protocol";


/** map 窓から main 窓へ転送するキー入力(main 窓が移動とキー操作をまとめて処理する) */
export const KEY_EVENT = "phi-key";
export type ForwardedKey = Pick<KeyboardEvent, "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "repeat"> & {
  type: "keydown" | "keyup" | "blur";
};

/** map 窓から main 窓へ転送するマウス操作 */
export const MOUSE_EVENT = "phi-mouse";
export type ForwardedMouse = { type: "down" | "move"; keys: MoveKey[] } | { type: "up" | "hit" };

/** フルキー移動は設定から(既定は on。Philly の既定は off だが、無いと 7・8・9 が番号として送られ発言になる) */
export function keyContext(state: MapState | undefined, fullKeyMove: boolean): KeyContext {
  const map = state?.map;
  // Philly は 7x7 の北固定(ExMapSize57 && !ExMapStyleTurn)の時だけ方角で進む
  const northFix = !map || (map.size === 7 && map.style !== "turn");
  return { northFix, fullKeyMove };
}

/** 送った行を、同じ窓の中に SENT_EVENT で知らせる(リストを閉じる為。App が受ける) */
export const SENT_EVENT = "phi-sent";

export function sendLine(session: number, text: string) {
  invoke("send_line", { session, text }).catch(console.error);
  window.dispatchEvent(new CustomEvent(SENT_EVENT, { detail: { session, text } }));
}

/** 移動以外のキー操作を行う */
export function runKeyAction(
  action: KeyAction,
  session: number,
  hooks: {
    focusInput: () => void;
    nextTab: () => void;
    openBoard: () => void;
    toggleMap: () => void;
    /** 次に届くリストを n 個出さない(Philly の NextListCancel) */
    cancelList: (n: number) => void;
  },
) {
  if ("send" in action) {
    if (action.confirm && !window.confirm(action.confirm)) return;
    if (action.cancelList) hooks.cancelList(action.cancelList);
    sendLine(session, action.send);
  } else if ("toggleMap" in action) hooks.toggleMap();
  else if ("write" in action) {
    sendLine(session, "write");
    hooks.openBoard();
  }
  else if ("pay" in action) {
    // ponytail: ブラウザ標準の入力ダイアログ。Philly の金額ダイアログ(IntInputDialog)に寄せるのは後
    const amount = window.prompt("支払い金額");
    if (amount !== null && /^\d+$/.test(amount.trim())) sendLine(session, `pay ${amount.trim()}`);
  } else if ("focusInput" in action) hooks.focusInput();
  else hooks.nextTab();
}

/** 入力欄やボタンで押したキーは文字入力として扱う */
export function isTextTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}
