import assert from "node:assert/strict";
import { test } from "node:test";
import { pushLine, pushLines, type LogLine } from "./logLines.ts";

test("古い行を捨てても残った行の id は変わらない", () => {
  let lines: LogLine[] = [];
  for (const h of ["a", "b", "c"]) lines = pushLine(lines, h, 2);
  assert.deepEqual(lines.map((l) => l.html), ["b", "c"]);
  const ids = lines.map((l) => l.id);
  lines = pushLine(lines, "d", 2);
  assert.equal(lines[0].id, ids[1]);
  assert.notEqual(lines[1].id, ids[1]);
});

test("pushLines はまとめて足し、上限を超えた古い行を捨てる", () => {
  let lines = pushLines([], ["a", "b"], 3);
  lines = pushLines(lines, ["c", "d"], 3);
  assert.deepEqual(
    lines.map((l) => l.html),
    ["b", "c", "d"],
  );
  assert.deepEqual(
    pushLines(lines, ["e", "f", "g", "h"], 3).map((l) => l.html),
    ["f", "g", "h"],
  );
});
