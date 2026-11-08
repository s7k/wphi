// 語や数を聞くダイアログ(Philly の InputQuery と IntInputDialog)。main 窓の中に出す。
import { useState } from "react";
import type { AskOptions } from "./keys.ts";

export function AskDialog(props: { opts: AskOptions; onAnswer: (text: string | null) => void }) {
  const [text, setText] = useState(props.opts.initial ?? "");
  const ok = !props.opts.numeric || /^\d+$/.test(text.trim());
  return (
    <div className="ask-backdrop">
      <form
        className="ask-dialog"
        role="dialog"
        aria-label={props.opts.title}
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) props.onAnswer(text);
        }}
        // キーを Philly の操作にしない
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") props.onAnswer(null);
        }}
      >
        <h2>{props.opts.title}</h2>
        <label>
          {props.opts.label}
          <input
            autoFocus
            value={text}
            inputMode={props.opts.numeric ? "numeric" : undefined}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="confirm-buttons">
          <button type="submit" disabled={!ok}>
            {props.opts.numeric ? "送信" : "OK"}
          </button>
          <button type="button" onClick={() => props.onAnswer(null)}>
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
