/** ログの1行。id は行ごとに増える通し番号で、古い行を捨てても残りの行の key が変わらない */
export type LogLine = { id: number; html: string };

export const MAX_LINES = 2000;

let nextId = 0;

/** 末尾に1行足し、max を超えた古い行を捨てる */
export function pushLine(lines: LogLine[], html: string, max = MAX_LINES): LogLine[] {
  return pushLines(lines, [html], max);
}

/** 末尾に複数の行を足し、max を超えた古い行を捨てる */
export function pushLines(lines: LogLine[], htmls: string[], max = MAX_LINES): LogLine[] {
  const added = htmls.slice(-max).map((html) => ({ id: nextId++, html }));
  return [...lines.slice(Math.max(0, lines.length + added.length - max)), ...added];
}

/** Log.css は Philly では IE の別文書に当てていた。body をログ欄に読み替えて使う */
export function scopeLogCss(css: string): string {
  return css.replace(/(^|[\s,}])body(?=[\s,{])/g, "$1.phi-log");
}
