import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { LogLines } from "./LogLineList";
import { lightenColors, type LogLine } from "./logLines.ts";

/**
 * ログ欄。follow が on の時は、ログが増えるたびと、中の画像が読み込まれて高さが変わるたびに最下行へ移る。
 * off は Philly の「ログスクロール停止」に当たる
 */
export const LogView = memo(function LogView(props: { lines: LogLine[]; follow: boolean; light?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const follow = useRef(props.follow);
  follow.current = props.follow;

  const toBottom = () => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  };
  useEffect(toBottom, [props.lines, props.follow]);
  // モダンは地図の上に白い文字で出すので、色の付いた文字を白に寄せて薄くする(style.css の [data-lc])
  useLayoutEffect(() => {
    if (props.light && inner.current) lightenColors(inner.current);
  }, [props.lines, props.light]);
  useEffect(() => {
    if (!inner.current) return;
    const ro = new ResizeObserver(toBottom);
    ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="phi-log"
      // フォーカスを受けると「移動モード」になり、キーが操作になる
      tabIndex={0}
    >
      <div ref={inner}>
        <LogLines lines={props.lines} />
      </div>
    </div>
  );
});
