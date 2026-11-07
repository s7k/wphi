import { invoke } from "@tauri-apps/api/core";
import { keyAction } from "./keys";
import type { MapState } from "./protocol";

/**
 * フルキーの 789 uio jkl m をテンキーとして使うか(Philly.ini の FullKeyMove)。
 * Philly の既定は off だが、無いと 7・8・9 が番号としてそのまま送られ、サーバが発言として扱う。
 * 作者が使うので既定を on にした。設定画面で切り替えるのは P4
 */
const FULL_KEY_MOVE = true;

/** 入力欄の外で押したキーを Philly の操作として送る。操作にしたら true。 */
export function handleGameKey(
  e: KeyboardEvent,
  state: MapState | undefined,
  hooks: { focusInput: () => void; nextTab: () => void },
): boolean {
  if (!state || state.session < 0) return false;
  const map = state.map;
  const northFix = !map || (map.size === 7 && map.style !== "turn");
  const action = keyAction(e, { northFix, fullKeyMove: FULL_KEY_MOVE });
  if (!action) return false;
  e.preventDefault();
  // ponytail: 押し続けによるリピートは送らない。Philly のリピート移動(マップの受信に合わせて進む)は後で作る
  if (e.repeat) return true;
  const send = (text: string) => invoke("send_line", { session: state.session, text }).catch(console.error);
  if ("send" in action) send(action.send);
  else if ("pay" in action) {
    // ponytail: ブラウザ標準の入力ダイアログ。Philly の金額ダイアログ(IntInputDialog)に寄せるのは後
    const amount = window.prompt("支払い金額");
    if (amount !== null && /^\d+$/.test(amount.trim())) send(`pay ${amount.trim()}`);
  } else if ("focusInput" in action) hooks.focusInput();
  else hooks.nextTab();
  return true;
}

/** 入力欄やボタンで押したキーは文字入力として扱う */
export function isTextTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}
