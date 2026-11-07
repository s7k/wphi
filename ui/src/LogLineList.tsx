import { memo } from "react";
import type { LogLine } from "./logLines.ts";

// html は phi-proto の tag_to_html がエスケープ済みで作ったもの。
// memo で、同じ行の innerHTML を作り直さない
const Line = memo(function Line(props: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: props.html }} />;
});

export function LogLines(props: { lines: LogLine[] }) {
  return props.lines.map((l) => <Line key={l.id} html={l.html} />);
}
