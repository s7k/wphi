import { useLayoutEffect, useRef } from "react";
import { lightenColors } from "./logLines.ts";
import { X } from "lucide-react";

/**
 * 看板などの本文の札(試験中)。ログと同じ HTML で、タグの色と大きさを反映する。札は暗い地なので、色の付いた文字は
 * モダンのログと同じく白へ寄せる(lightenColors)。× か Esc か、歩くと閉じる。本文はログにも残る
 */
export function SignCard(props: { lines: string[]; author: { name: string; date: string } | null; onClose: () => void }) {
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (body.current) lightenColors(body.current);
  }, [props.lines]);
  return (
    <div className="sign-card" role="dialog" aria-label="看板・お知らせ">
      <div className="sign-head">
        {/* 看板なら書いた人と日付。サーバが本文の前に送る行から取る (ui/src/signHead.ts) */}
        {props.author ? (
          <span title={`${props.author.name} (${props.author.date})`}>
            {props.author.name}
            <span className="sign-date">{props.author.date}</span>
          </span>
        ) : (
          <span>看板・お知らせ</span>
        )}
        <button type="button" title="閉じる(Esc)" onClick={props.onClose}>
          <X />
        </button>
      </div>
      <div className="sign-body" ref={body}>
        {props.lines.map((l, i) => (
          // html は phi-proto の tag_to_html がエスケープ済みで作ったもの(LogLineList.tsx と同じ)
          <div key={i} data-line={i} dangerouslySetInnerHTML={{ __html: l }} />
        ))}
      </div>
    </div>
  );
}
