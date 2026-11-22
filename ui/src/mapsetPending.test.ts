import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMapset, holdMapset } from "./mapsetPending.ts";

test("地図より先に届いたマップセットを貯め、地図が届いた時にまとめて入れる", () => {
  let p = holdMapset(undefined, { mapset: "town" }, ["a", "b"]);
  p = holdMapset(p, { mapsetDefine: [1, "B"] }, ["a", "b"]);
  p = holdMapset(p, { mapsetDefine: [3, "D"] }, ["a", "b"]);
  const state = { mapset: "field", defines: ["a", "b"] };
  applyMapset(state, p);
  assert.equal(state.mapset, "town");
  assert.equal(state.defines.length, 4);
  assert.deepEqual([state.defines[0], state.defines[1], state.defines[3]], ["a", "B", "D"]);
});

test("貯めた物が無ければ地図の状態を変えず、今の地図の defines は書き換えない", () => {
  const current = ["a"];
  const p = holdMapset(undefined, { mapsetDefine: [0, "A"] }, current);
  assert.deepEqual(current, ["a"]);
  const state = { mapset: "field", defines: current };
  applyMapset(state, undefined);
  assert.deepEqual(state, { mapset: "field", defines: ["a"] });
  applyMapset(state, p);
  assert.deepEqual(state.defines, ["A"]);
});
