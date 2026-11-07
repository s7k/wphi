// 看板エディタ(Philly の MEditForm)。#m-edit を受けた時と、S(write)を押した時に開く。
// Philly は別窓だが、窓の配置は P4 でまとめて決めるので、今は main 窓の中に重ねる。
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { boardText } from "./boardText.ts";
import { TagMenu, type TagMenuAt } from "./TagMenu";

function previewHeader(name: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const time = `(${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())})`;
  return `${name.padEnd(16)}${time}\n----------------------------------------------\n`;
}

export function BoardEditor(props: { name: string; onSend: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tagMenu, setTagMenu] = useState<TagMenuAt | null>(null);

  useEffect(() => ref.current?.focus(), []);
  // プレビューはログと同じ HTML とスキンの Log.css で出す
  useEffect(() => {
    invoke<string>("log_html", { text: previewHeader(props.name) + text })
      .then(setPreview)
      .catch(console.error);
  }, [text, props.name]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Shift+Enter で送る(MEditForm.cpp の InputEditKeyDown)
    if (e.key === "Enter" && e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      props.onSend(boardText(text));
    }
    if (e.key === "Escape" && !e.nativeEvent.isComposing) props.onCancel();
  }

  return (
    <div className="board-editor">
      <div className="board-title">看板エディッタ({props.name})</div>
      <div className="board-body">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => {
            e.preventDefault();
            setTagMenu({ x: e.clientX, y: e.clientY, ta: e.currentTarget });
          }}
          spellCheck={false}
        />
        {tagMenu && <TagMenu at={tagMenu} onInsert={setText} onClose={() => setTagMenu(null)} />}
        {/* tag_to_html がエスケープしてから作った HTML */}
        <div className="phi-log board-preview" dangerouslySetInnerHTML={{ __html: preview }} />
      </div>
      <div className="board-buttons">
        <button onClick={() => props.onSend(boardText(text))}>送信(Shift+Enter)</button>
        <button onClick={props.onCancel}>キャンセル</button>
      </div>
    </div>
  );
}
