/** ログの1行。id は行ごとに増える通し番号で、古い行を捨てても残りの行の key が変わらない。
 * raw は元の行(PHI のタグ付き)。ログ欄の右クリックメニューのコピーに使う(#81)。クライアントが出す行には無い */
export type LogLine = { id: number; html: string; raw?: string };

export const MAX_LINES = 2000;

let nextId = 0;

/** 末尾に1行足し、max を超えた古い行を捨てる */
export function pushLine(lines: LogLine[], html: string, max = MAX_LINES): LogLine[] {
  return pushLines(lines, [html], max);
}

/** 末尾に複数の行を足し、max を超えた古い行を捨てる */
export function pushLines(lines: LogLine[], htmls: (string | { html: string; raw?: string })[], max = MAX_LINES): LogLine[] {
  const added = htmls.slice(-max).map((h) => (typeof h === "string" ? { id: nextId++, html: h } : { id: nextId++, ...h }));
  return [...lines.slice(Math.max(0, lines.length + added.length - max)), ...added];
}

/** ログの CSS は Philly の Log.css と同じく body に当てる書き方なので、body をログ欄に読み替えて使う */
export function scopeLogCss(css: string): string {
  return css.replace(/(^|[\s,}])body(?=[\s,{])/g, "$1.phi-log");
}

/**
 * まだ見ていない行の、親と違う色の要素に、その色を白へ寄せた色を --lc で付ける。
 * 色は Log.css のクラスとタグの style の両方から来るので、付いた結果の色を読む。行ごとに一度だけ見る
 */
export function lightenColors(root: HTMLElement) {
  const lines = root.querySelectorAll<HTMLElement>("[data-line]:not([data-lc-done])");
  // 先に全部の色を読んでから書く。書きながら読むと、子が薄くした親の色と比べることになる
  const found: [HTMLElement, string][] = [];
  for (const line of lines) {
    for (const el of line.querySelectorAll<HTMLElement>("*")) {
      const color = getComputedStyle(el).color;
      if (el.parentElement && color !== getComputedStyle(el.parentElement).color) found.push([el, color]);
    }
  }
  for (const [el, color] of found) {
    el.style.setProperty("--lc", `color-mix(in srgb, ${color} 45%, white)`);
    el.dataset.lc = "";
  }
  for (const line of lines) line.dataset.lcDone = "";
}
