import { memo } from "react";
import type { LogLine } from "./logLines.ts";

// html は phi-proto の tag_to_html がエスケープ済みで作ったもの。
// memo で、同じ行の innerHTML を作り直さない
// data-line は右クリックメニューで選んだ行を探す為(#81)
const Line = memo(function Line(props: { id: number; html: string }) {
  return <div data-line={props.id} dangerouslySetInnerHTML={{ __html: props.html }} />;
});

export function LogLines(props: { lines: LogLine[] }) {
  return props.lines.map((l) => <Line key={l.id} id={l.id} html={l.html} />);
}
