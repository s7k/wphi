// リスト(Philly のチェックリストボックス)。ログの上に重ねて出す(Philly.ini の OverrapLog=on)。
// 番号キー・Space・Enter の操作は App のキー処理が行い、ここはマウスの操作と表示を受け持つ。

export type ListState = {
  lines: string[];
  checked: boolean[];
  cursor: number;
};

/** チェックした番号を空白区切りで。何もチェックしていなければカーソルの行の番号 */
export function listOk(l: ListState): string {
  const nos = l.checked.flatMap((c, i) => (c ? [String(i + 1)] : []));
  return nos.length > 0 ? nos.join(" ") : String(l.cursor + 1);
}

const stripTags = (s: string) => s.replace(/\/\*.*?\*\//g, "");

export function ListOverlay(props: { list: ListState; onChange: (l: ListState) => void; onSend: (text: string) => void }) {
  const l = props.list;
  const toggle = (i: number) =>
    props.onChange({ ...l, cursor: i, checked: l.checked.map((c, j) => (j === i ? !c : c)) });
  return (
    <div className="list-overlay">
      <ul>
        {l.lines.map((line, i) => (
          <li key={i} className={i === l.cursor ? "cursor" : undefined}>
            <label>
              <input type="checkbox" checked={l.checked[i] ?? false} onChange={() => toggle(i)} />
              {stripTags(line)}
            </label>
          </li>
        ))}
      </ul>
      <div className="list-buttons">
        <button onClick={() => props.onSend(listOk(l))}>送る</button>
        <button onClick={() => props.onSend("-")}>すべて</button>
        <button onClick={() => props.onSend(".")}>取り消し</button>
      </div>
    </div>
  );
}
