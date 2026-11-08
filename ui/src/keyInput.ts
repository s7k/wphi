import { confirmBox } from "./MessageDialog";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AskOptions, KeyAction, KeyContext, MoveKey } from "./keys.ts";
import type { MapState } from "./protocol";


/** map 窓から main 窓へ転送するキー入力(main 窓が移動とキー操作をまとめて処理する) */
export const KEY_EVENT = "phi-key";
export type ForwardedKey = Pick<KeyboardEvent, "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "repeat"> & {
  type: "keydown" | "keyup";
};

/** map 窓から main 窓へ転送するマウス操作 */
export const MOUSE_EVENT = "phi-mouse";
export type ForwardedMouse = { type: "down"; keys: MoveKey[] } | { type: "hit" };

/** フルキー移動は設定から(既定は on。Philly の既定は off だが、無いと 7・8・9 が番号として送られ発言になる) */
export function keyContext(state: MapState | undefined, fullKeyMove: boolean): KeyContext {
  const map = state?.map;
  // Philly は 7x7 の北固定(ExMapSize57 && !ExMapStyleTurn)の時だけ方角で進む
  const northFix = !map || (map.size === 7 && map.style !== "turn");
  return { northFix, fullKeyMove };
}

/** 送った行を main 窓へ SENT_EVENT で知らせる(リストを閉じる為。App が受ける)。
 * main 窓の中ではすぐ知らせ、map 窓からは Tauri のイベントで送る(#64) */
export const SENT_EVENT = "phi-sent";
export type Sent = { session: number; text: string };

function notifySent(detail: Sent) {
  if (getCurrentWindow().label === "main") window.dispatchEvent(new CustomEvent(SENT_EVENT, { detail }));
  else emitTo("main", SENT_EVENT, detail).catch(console.error);
}

export function sendLine(session: number, text: string) {
  invoke("send_line", { session, text }).catch(console.error);
  notifySent({ session, text });
}

/** 改行を含む文字列(看板の本文、F8〜F12)を1行ずつ順に送る。sendLine は改行を含む文字列を送らない */
export function sendLines(session: number, text: string) {
  invoke("send_lines", { session, lines: text.split(/\r?\n/) }).catch(console.error);
  notifySent({ session, text });
}

/** 移動以外のキー操作を行う */
/** 系統魔法を唱える行の頭(src-tauri/src/auto_unequip.rs)。サーバへは送らない */
export const CAST_PREFIX = "#wphi-cast ";

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
    /** 語や数を聞く。取り消したら null */
    ask: (opts: AskOptions) => Promise<string | null>;
    /** 系統魔法の前に武器を外すか、唱えた後に装備し直すか(設定) */
    systemMagic: () => { unequip: boolean; equip: boolean };
  },
) {
  if ("ask" in action) {
    hooks.ask(action.ask).then((text) => {
      const t = text?.trim() ?? "";
      if (t === "" || (action.ask.numeric && !/^\d+$/.test(t))) return;
      if (action.cancelList) hooks.cancelList(action.cancelList);
      sendLines(session, action.send.replace("{}", t));
    });
  } else if ("send" in action) {
    const go = () => {
      if (action.cancelList) hooks.cancelList(action.cancelList);
      const sm = action.systemMagic && hooks.systemMagic();
      // 武器を外すのは session.rs が受け持つ。唱える行をまとめて1行で渡し、サーバへは unequip だけを先に送る(#4)
      if (sm && sm.unequip) {
        const reequip = action.systemMagic === "reequip" && sm.equip ? 1 : 0;
        sendLine(session, `${CAST_PREFIX}${reequip} ${action.send.split("\n").join("\t")}`);
      } else sendLines(session, action.send);
    };
    if (action.confirm) confirmBox(action.confirm).then((ok) => ok && go());
    else go();
  } else if ("toggleMap" in action) hooks.toggleMap();
  else if ("write" in action) {
    sendLine(session, "write");
    hooks.openBoard();
  }
  else if ("focusInput" in action) hooks.focusInput();
  else if ("menu" in action) invoke("menu_select", { id: action.menu }).catch(console.error);
  else hooks.nextTab();
}

/** 入力欄やボタンで押したキーは文字入力として扱う */
export function isTextTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  // チェックボックスやボタンは文字を打たないので、キーを操作に回す(#66)
  if (t instanceof HTMLInputElement) return !NOT_TEXT_INPUTS.includes(t.type);
  return t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}
const NOT_TEXT_INPUTS = ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"];
