import assert from "node:assert/strict";
import { test } from "node:test";
import { pushLine, type LogLine } from "./logLines.ts";

test("古い行を捨てても残った行の id は変わらない", () => {
  let lines: LogLine[] = [];
  for (const h of ["a", "b", "c"]) lines = pushLine(lines, h, 2);
  assert.deepEqual(lines.map((l) => l.html), ["b", "c"]);
  const ids = lines.map((l) => l.id);
  lines = pushLine(lines, "d", 2);
  assert.equal(lines[0].id, ids[1]);
  assert.notEqual(lines[1].id, ids[1]);
});
