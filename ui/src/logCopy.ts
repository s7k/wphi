// ログ欄からのコピー(Philly の Command.cpp の HtmlToTag と TagToHtml.cpp)。#81
// Philly は表示中の HTML をタグへ戻していたが、WPHI は受けた時の行(raw)を覚えておき、それを使う。
// 選んだ範囲は行の単位で扱う(行の途中だけを選んでも、その行の全部を使う)
import type { LogLine } from "./logLines.ts";

export type CopyOptions = {
  /** PHI のタグ(/*〜*\/)を除く */
  deleteTags: boolean;
  /** 行頭の時刻を除く(LogTimeDelete) */
  deleteTime: boolean;
  /** 発言の「名前 > 」を除く(LogNameDelete) */
  deleteName: boolean;
  /** タグを無効にする。/* を /＊ にする(LogTagCancel) */
  cancelTags: boolean;
};

const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/** 1行をコピーする文字にする */
export function lineText(line: LogLine, o: CopyOptions): string {
  const time = /<font class="class_time">(.*?)<\/font>/.exec(line.html)?.[1] ?? "";
  let text = line.raw ?? decode(line.html.replace(/<font class="class_time">.*?<\/font>/, ""));
  if (o.deleteName) text = text.replace(/^[^>\n]+? > /, "");
  if (o.deleteTags) text = text.replace(/\/\*.*?\*\//g, "");
  if (o.cancelTags) text = text.replaceAll("/*", "/＊");
  return (o.deleteTime ? "" : decode(time)) + text;
}

export const copyText = (lines: LogLine[], o: CopyOptions) => lines.map((l) => lineText(l, o)).join("\n");

/** 選んだ範囲(先頭と末尾の行の id)に入る行。選んでいなければ、押した行だけ */
export function selectedLines(lines: LogLine[], ids: number[]): LogLine[] {
  if (ids.length === 0) return [];
  const lo = Math.min(...ids);
  const hi = Math.max(...ids);
  return lines.filter((l) => l.id >= lo && l.id <= hi);
}
