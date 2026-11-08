// リスト(Philly のチェックリストボックス)。ログの上に重ねて出す(Philly.ini の OverrapLog=on)。
// 番号キー・Space・Enter の操作は App のキー処理が行い、ここはマウスの操作と表示を受け持つ。

import { useEffect, useRef } from "react";
import { hasMore, listOk, moreNo, pageTop, type ListState } from "./list.ts";

const stripTags = (s: string) => s.replace(/\/\*.*?\*\//g, "");

export function ListOverlay(props: {
  list: ListState;
  onChange: (l: ListState) => void;
  onSend: (text: string) => void;
  onMore: (text: string) => void;
}) {
  const l = props.list;
  const toggle = (i: number) =>
    props.onChange({ ...l, cursor: i, checked: l.checked.map((c, j) => (j === i ? !c : c)) });
  // 前のページの行も残して出し、今のページの行にだけ (1)〜(9) を付ける(Philly の SynchronizeShowList。#84)
  const top = pageTop(l);
  const ul = useRef<HTMLUListElement>(null);
  // 続きのページが届いたら、一番下まで送る
  useEffect(() => {
    ul.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [l.lines.length]);
  return (
    <div className="list-overlay">
      <ul ref={ul}>
        {l.lines.map((line, i) => (
          <li
            key={i}
            className={i === l.cursor ? "cursor" : undefined}
            // ダブルクリックで OK(Philly の ListBox の OnDblClick)
            onDoubleClick={() => props.onSend(listOk({ ...l, cursor: i }))}
          >
            <label>
              <input type="checkbox" checked={l.checked[i] ?? false} onChange={() => toggle(i)} />
              {i >= top && <span className="list-key">({i - top + 1})</span>}
              {stripTags(line)}
            </label>
          </li>
        ))}
      </ul>
      {/* ボタン名は Philly と同じ(MainForm.cpp)。More は9件目(続きの印)がある時だけ押せる */}
      <div className="list-buttons">
        <button onClick={() => props.onSend(listOk(l))}>O K</button>
        <button onClick={() => props.onSend(".")}>Cancel</button>
        <button disabled={!hasMore(l) || !!l.waiting} onClick={() => props.onMore(moreNo(l))}>
          More
        </button>
      </div>
    </div>
  );
}
