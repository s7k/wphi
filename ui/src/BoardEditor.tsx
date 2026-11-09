// 看板エディタ(Philly の MEditForm)。#m-edit を受けた時と、S(write)を押した時に開く。
// Philly は別窓だが、窓の配置は P4 でまとめて決めるので、今は main 窓の中に重ねる。
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { boardText } from "./boardText.ts";
import { TAG_MENU, type TagItem } from "./tagMenu.ts";
import { TagMenu, applyTag, type TagMenuAt } from "./TagMenuPopup";

// 読む人の OS に無いフォントは、読む人の既定のフォントで出る
const FONTS = [
  "ＭＳ ゴシック",
  "ＭＳ 明朝",
  "メイリオ",
  "游ゴシック",
  "游明朝",
  "ヒラギノ角ゴシック",
  "ヒラギノ明朝 ProN",
];
const close = "/*.*/";
const [COLORS, SIZES, STYLES] = TAG_MENU.map((g) =>
  g.items.filter((t) => t.tag.endsWith("*/")),
);
const label = (t: TagItem) => t.caption.split("(")[0];

function TagToolbar(props: {
  ta: () => HTMLTextAreaElement | null;
  onInsert: (value: string) => void;
}) {
  const apply = (t: TagItem) => {
    const ta = props.ta();
    if (ta) applyTag(ta, t, props.onInsert);
  };
  // ボタンを押してもフォーカスと選んだ範囲を textarea に残す
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  return (
    <div className="board-toolbar" onMouseDown={keep}>
      {COLORS.map((t) => {
        const name = label(t);
        return (
          <button
            key={name}
            title={name}
            className="board-swatch"
            style={{ background: t.tag.slice(8, -2) }}
            onClick={() => apply(t)}
          />
        );
      })}
      <input
        type="color"
        title="好きな色"
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) =>
          apply({ caption: "", tag: `/*color=${e.target.value}*/`, close })
        }
      />
      <span className="board-sep" />
      {[...SIZES, ...STYLES].map((t) => (
        <button key={t.tag} title={t.tag} onClick={() => apply(t)}>
          {{
            Large: "大",
            Small: "小",
            Bold: "太",
            Italic: "斜",
            Strike: "消",
            Under: "下線",
            Sup: "上付",
            Sub: "下付",
          }[label(t)] ?? label(t)}
        </button>
      ))}
      <span className="board-sep" />
      <select
        value=""
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "*")
            apply({ caption: "", tag: "/*font=", close: "*/" + close });
          else if (v) apply({ caption: "", tag: `/*font=${v}*/`, close });
        }}
      >
        <option value="">フォント</option>
        {FONTS.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>
            {f}
          </option>
        ))}
        <option value="*">名前を書く...</option>
      </select>
    </div>
  );
}

function previewHeader(name: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const time = `(${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())})`;
  return `${name.padEnd(16)}${time}\n----------------------------------------------\n`;
}

export function BoardEditor(props: {
  name: string;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
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
      <div className="board-title">看板を書く({props.name})</div>
      <TagToolbar ta={() => ref.current} onInsert={setText} />
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
        {tagMenu && (
          <TagMenu
            at={tagMenu}
            onInsert={setText}
            onClose={() => setTagMenu(null)}
          />
        )}
        {/* tag_to_html がエスケープしてから作った HTML */}
        <div
          className="phi-log board-preview"
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      </div>
      <div className="board-buttons">
        <button onClick={() => props.onSend(boardText(text))}>
          送信(Shift+Enter)
        </button>
        <button onClick={props.onCancel}>キャンセル</button>
      </div>
    </div>
  );
}
