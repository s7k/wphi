// 入力欄の発言の前処理(Philly の MainForm.cpp の SendFromInputEdit)。
// 設定は Philly.ini の既定値(LoudlyByAsterisk=0、PartyTalkByCtrl=on、EditSendNullLine=on)。

/** 入力欄の行数の上限(Philly.ini の EditMaxLine) */
export const EDIT_MAX_LINE = 100;

/**
 * 送る行を作る。送らない時は null。
 * - 空行は `/**\/` にして送る。ただし最後の行の空行は送らない
 * - 大声モードなら先頭に `*`
 * - 大声モードでないのに先頭が `*` なら `/**\/` を前置して大声にしない
 * - Ctrl+Enter はパーティー発言(先頭に `+`)
 */
export function prepareLine(text: string, opts: { ctrl: boolean; loud: boolean; lastLine: boolean }): string | null {
  if (text.length === 0) return opts.lastLine ? null : "/**/";
  if (opts.loud) return `*${text}`;
  if (text.startsWith("*")) return `/**/${text}`;
  if (opts.ctrl) return `+${text}`;
  return text;
}

/** テキストエリアのカーソルがある行 */
export function caretLine(value: string, pos: number): { text: string; index: number; count: number; start: number } {
  const lines = value.split("\n");
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const end = start + lines[i].length;
    if (pos <= end) return { text: lines[i], index: i, count: lines.length, start };
    start = end + 1;
  }
  const last = lines.length - 1;
  return { text: lines[last], index: last, count: lines.length, start: value.length - lines[last].length };
}

/**
 * 送った後の入力欄(Philly は送った行を残し、最後の行なら新しい行を足す。途中の行なら次の行へ移る)。
 * 行数が上限を超えたら古い行から消す。
 */
export function afterSend(value: string, pos: number): { value: string; caret: number } {
  const line = caretLine(value, pos);
  if (line.index + 1 < line.count) {
    return { value, caret: line.start + line.text.length + 1 };
  }
  let lines = [...value.split("\n"), ""];
  if (lines.length > EDIT_MAX_LINE) lines = lines.slice(lines.length - EDIT_MAX_LINE);
  const next = lines.join("\n");
  return { value: next, caret: next.length };
}
