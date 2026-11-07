/** ログの1行。id は行ごとに増える通し番号で、古い行を捨てても残りの行の key が変わらない */
export type LogLine = { id: number; html: string };

export const MAX_LINES = 2000;

let nextId = 0;

/** 末尾に1行足し、max を超えた古い行を捨てる */
export function pushLine(lines: LogLine[], html: string, max = MAX_LINES): LogLine[] {
  const keep = lines.length >= max ? lines.slice(lines.length - max + 1) : lines.slice();
  keep.push({ id: nextId++, html });
  return keep;
}
