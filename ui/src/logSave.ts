// ログを利用者の地域の日付のファイルに足す (append_log)。App.tsx から出した。
// 1つ前の書き込みが終わってから書く。並行に書くと、行の順序が入れ替わり、ヘッダが二重になる(#65)。
// 前の書き込みを待つ間に届いた行は、まとめて 1 回で書く。1 行ごとに直列に呼ぶと、書き込みが遅い時に行が溜まり続けた(#122)

/** append_log を呼ぶ。保存先のパスを返す */
export type AppendLog = (args: { label: string; date: string; lines: string[]; asHtml: boolean }) => Promise<string>;

/** 日付のファイル名の部分 (YYYYMMDD) */
export function logDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** 書く関数を作る。返す関数は、その行を書き終えた時に保存先のパスで終わる */
export function createLogWriter(append: AppendLog, onError: (e: unknown) => void = console.error) {
  let queue: Promise<unknown> = Promise.resolve();
  /** まだ書き始めていない分 */
  let batch: { key: string; lines: string[]; done: Promise<string | void> } | null = null;
  return (label: string, line: string, asHtml: boolean, date: string = logDate(new Date())): Promise<string | void> => {
    const key = `${label}\n${date}\n${asHtml}`;
    if (batch?.key === key) {
      batch.lines.push(line);
      return batch.done;
    }
    const lines = [line];
    const mine: NonNullable<typeof batch> = {
      key,
      lines,
      done: queue.then(() => {
        if (batch === mine) batch = null;
        return append({ label, date, lines, asHtml }).catch(onError);
      }),
    };
    batch = mine;
    queue = mine.done;
    return mine.done;
  };
}
