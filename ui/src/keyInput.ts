import { invoke } from "@tauri-apps/api/core";
import type { KeyAction, KeyContext } from "./keys.ts";
import type { MapState } from "./protocol";

/**
 * フルキーの 789 uio jkl m をテンキーとして使うか(Philly.ini の FullKeyMove)。
 * Philly の既定は off だが、無いと 7・8・9 が番号としてそのまま送られ、サーバが発言として扱う。
 * 作者が使うので既定を on にした。設定画面で切り替えるのは P4
 */
const FULL_KEY_MOVE = true;

/** map 窓から main 窓へ転送するキー入力(main 窓が移動とキー操作をまとめて処理する) */
export const KEY_EVENT = "phi-key";
export type ForwardedKey = Pick<KeyboardEvent, "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "repeat"> & {
  type: "keydown" | "keyup" | "blur";
};

export function keyContext(state: MapState | undefined): KeyContext {
  const map = state?.map;
  // Philly は 7x7 の北固定(ExMapSize57 && !ExMapStyleTurn)の時だけ方角で進む
  const northFix = !map || (map.size === 7 && map.style !== "turn");
  return { northFix, fullKeyMove: FULL_KEY_MOVE };
}

export function sendLine(session: number, text: string) {
  invoke("send_line", { session, text }).catch(console.error);
}

/** 移動以外のキー操作を行う */
export function runKeyAction(
  action: KeyAction,
  session: number,
  hooks: { focusInput: () => void; nextTab: () => void; openBoard: () => void },
) {
  if ("send" in action) sendLine(session, action.send);
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
