import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { afterSend, caretLine, prepareLine } from "./chat.ts";
import { sendLine } from "./keyInput";
import { confirmBox } from "./MessageDialog";
import { popupTagMenu } from "./TagMenuPopup";
import { ArrowDownToLine, Check, FolderOpen, Megaphone, MessageSquare, Layers, Save, X, MapPin } from "lucide-react";

/** 入力欄のツールバーと同じ切り替えのメニュー項目(src-tauri/src/menu.rs の 操作)。App から InputEditor へ送る */
export const INPUT_MENU = ["loud", "all-tab", "log-save", "log-follow", "open-log-dir"];
export const INPUT_MENU_EVENT = "phi-input-menu";

/**
 * 入力欄(Philly の InputEdit)。Philly と同じ複数行のエディタで、Enter はカーソルの行を送り、送った行は欄に残す。
 * Ctrl+Enter はパーティの発言、Shift+Enter は改行。
 * value を React に持たせない。ログが届くたびの再描画で value を書き戻すと、WebKitGTK が変換中の文字を消す
 */
export function InputEditor(props: {
  session: number;
  /** 追加発言(Philly の TalkAdd)。新しい行と、最後の行で ↓ を押した時の行をこれで始める */
  talkAdd: string;
  sessions: number[];
  disabled: boolean;
  onPriv: () => void;
  /** パーティに入っている間だけ出す、入力欄の上の「全体」「パーティ」のタブ */
  party: { mode: boolean; unread: boolean } | null;
  onPartyMode: (on: boolean) => void;
  logSave: boolean;
  onLogSave: (on: boolean) => void;
  onOpenLogDir: () => void;
  logFollow: boolean;
  onLogFollow: (on: boolean) => void;
}) {
  const [loud, setLoud] = useState(false);
  // エリアの発言 (同じ区域の全員へ。#190)。大声とは同時に選ばない
  const [area, setArea] = useState(false);
  // 確認で「すべて大声」を選んだ。大声を解除するまで確認せず、送っても大声のままにする(Philly の大声の確認)
  const [loudAll, setLoudAll] = useState(false);
  // 大声の確認で答えを待っている発言
  const [loudAsk, setLoudAsk] = useState<{ deliver: () => void; ta: HTMLTextAreaElement } | null>(null);
  const [allTab, setAllTab] = useState(false);
  // 連続送信を 100ms 空ける(Philly の SendFromInputEdit)
  const lastSend = useRef(0);

  function send(ta: HTMLTextAreaElement, ctrl: boolean) {
    const now = performance.now();
    if (now - lastSend.current < 100) return;
    lastSend.current = now;
    const line = caretLine(ta.value, ta.selectionStart);
    // パーティのタブでは、Ctrl+Enter と同じく仲間だけへ送る
    const text = prepareLine(line.text, {
      ctrl: ctrl || !!props.party?.mode,
      loud: loud && !allTab,
      area,
      lastLine: line.index + 1 >= line.count,
    });
    if (text === null) return;
    const deliver = () => {
      if (allTab) props.sessions.forEach((s) => sendLine(s, text));
      else sendLine(props.session, text);
      const next = afterSend(ta.value, ta.selectionStart, props.talkAdd);
      ta.value = next.value;
      ta.setSelectionRange(next.caret, next.caret);
      // 送った行が見えるよう、カーソルの位置までスクロールする
      ta.blur();
      ta.focus();
    };
    // 全タブ発言は確かめてから送る。断ったら全タブ発言を解除し、入力欄はそのまま
    if (allTab) {
      confirmBox("全タブに発言します。\nよろしいですか？").then((ok) => {
        if (ok) deliver();
        else setAllTab(false);
        ta.focus();
      });
      return;
    }
    // Philly は大声の前に確認し、送ったら大声を解除する。「すべて大声」の後は確認しない
    if (loud && !allTab && !loudAll) {
      setLoudAsk({ deliver, ta });
      return;
    }
    deliver();
  }

  // メニューの 操作 の切り替え
  useEffect(() => {
    const onMenu = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id === "loud") {
        setLoud((v) => !v);
        setLoudAll(false);
      } else if (id === "all-tab") setAllTab((v) => !v);
      else if (id === "log-save") props.onLogSave(!props.logSave);
      else if (id === "log-follow") props.onLogFollow(!props.logFollow);
      else if (id === "open-log-dir") props.onOpenLogDir();
    };
    window.addEventListener(INPUT_MENU_EVENT, onMenu);
    return () => window.removeEventListener(INPUT_MENU_EVENT, onMenu);
  });

  function answerLoud(answer: "yes" | "all" | "no") {
    const ask = loudAsk;
    setLoudAsk(null);
    if (!ask) return;
    if (answer === "all") setLoudAll(true);
    else setLoud(false);
    if (answer === "no") ask.ta.focus();
    else ask.deliver();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Esc でログ欄へ移り、キーを操作に使う(Philly の移動モード)
    if (e.key === "Escape" && !e.nativeEvent.isComposing) {
      document.querySelector<HTMLElement>(".log-area .log-shown .phi-log")?.focus();
      return;
    }
    // 最後の行で ↓ を押したら、その行を追加発言にする(Philly の InputEditKeyDown)
    const ta = e.currentTarget;
    if (e.key === "ArrowDown" && !e.shiftKey && !e.ctrlKey && !e.altKey && props.talkAdd) {
      const line = caretLine(ta.value, ta.selectionStart);
      if (line.index + 1 >= line.count) {
        e.preventDefault();
        ta.setRangeText(props.talkAdd, line.start, line.start + line.text.length, "end");
        return;
      }
    }
    // IME の変換確定の Enter では送らない。WebKit は確定の keydown で isComposing を false にし、keyCode 229 を返す
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229 || e.shiftKey || e.altKey) return;
    e.preventDefault();
    send(e.currentTarget, e.ctrlKey);
  }

  return (
    <div className="input-area">
      {loudAsk && (
        <div
          className="confirm-dialog"
          role="dialog"
          // キーを Philly の操作にしない。Esc は「いいえ」
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") answerLoud("no");
          }}
        >
          <p>
            大声で発言します。
            <br />
            この世界にいる全員に聞こえます。
            <br />
            よろしいですか？
          </p>
          <div className="confirm-buttons">
            <button autoFocus onClick={() => answerLoud("yes")}>
              <Check />
              はい
            </button>
            <button onClick={() => answerLoud("all")}>
              <Megaphone />
              すべて大声
            </button>
            <button onClick={() => answerLoud("no")}>
              <X />
              いいえ
            </button>
          </div>
        </div>
      )}
      <div className="input-toolbar">
        {props.party && (
          <div className="chat-tabs" role="tablist">
            <button role="tab" aria-selected={!props.party.mode} onClick={() => props.onPartyMode(false)}>
              全体
            </button>
            <button
              role="tab"
              aria-selected={props.party.mode}
              className={props.party.unread ? "unread" : undefined}
              title="仲間だけに発言し、仲間の発言だけを出す"
              onClick={() => props.onPartyMode(true)}
            >
              パーティ
            </button>
          </div>
        )}
        <label className={loud ? "toggle on" : "toggle"}>
          <input
            type="checkbox"
            checked={loud}
            onChange={(e) => {
              setLoud(e.target.checked);
              if (e.target.checked) setArea(false);
              if (!e.target.checked) setLoudAll(false);
            }}
          />
          <Megaphone />
          {loudAll ? "すべて大声" : "大声"}
        </label>
        <label className={area ? "toggle on" : "toggle"} title="同じ区域の全員に発言する (先頭に & を付けて送る)">
          <input
            type="checkbox"
            checked={area}
            onChange={(e) => {
              setArea(e.target.checked);
              if (e.target.checked) {
                setLoud(false);
                setLoudAll(false);
              }
            }}
          />
          <MapPin />
          エリア
        </label>
        <label className={allTab ? "toggle on" : "toggle"}>
          <input type="checkbox" checked={allTab} onChange={(e) => setAllTab(e.target.checked)} />
          <Layers />
          全タブ発言
        </label>
        <label className={props.logFollow ? "toggle on" : "toggle"} title="ログが増えたら最下行へ移る">
          <input type="checkbox" checked={props.logFollow} onChange={(e) => props.onLogFollow(e.target.checked)} />
          <ArrowDownToLine />
          ログを固定
        </label>
        <label className={props.logSave ? "toggle on" : "toggle"}>
          <input type="checkbox" checked={props.logSave} onChange={(e) => props.onLogSave(e.target.checked)} />
          <Save />
          ログ保存
        </label>
        <button className="toggle" title="ログの保存先のフォルダを開く" onClick={props.onOpenLogDir}>
          <FolderOpen />
          保存先
        </button>
        <button className="toggle" onClick={props.onPriv}>
          <MessageSquare />
          priv
        </button>
      </div>
      <textarea
        className={loud ? "input-line loud" : "input-line"}
        disabled={props.disabled}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          e.preventDefault();
          const ta = e.currentTarget;
          popupTagMenu(ta, (v) => (ta.value = v)).catch(console.error);
        }}
        rows={3}
        spellCheck={false}
        autoFocus
      />
    </div>
  );
}
