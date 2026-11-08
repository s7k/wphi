import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewer } from "./update.ts";

test("版を数として比べる", () => {
  assert.equal(isNewer("v0.1.30", "0.1.29"), true);
  assert.equal(isNewer("v0.1.30", "0.1.30"), false);
  assert.equal(isNewer("v0.1.9", "0.1.10"), false);
  assert.equal(isNewer("v0.2.0", "0.1.99"), true);
  assert.equal(isNewer("v1.0", "0.9.9"), true);
  assert.equal(isNewer("nightly", "0.1.0"), false);
});
