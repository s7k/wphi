import assert from "node:assert/strict";
import { test } from "node:test";
import { PALETTE, SPELL_PIXELS, spellPixels } from "./pixelIcons.ts";

test("魔法のアイコンは 16x16 で、色は PALETTE の文字か透明の '.' だけ", () => {
  for (const [ef, { rows }] of Object.entries(SPELL_PIXELS)) {
    assert.equal(rows.length, 16, ef);
    for (const r of rows) {
      assert.equal(r.length, 16, `${ef} ${r}`);
      for (const c of r) assert.ok(c === "." || c in PALETTE, `${ef} ${c}`);
    }
  }
});

test("効果 (EF_*) ごとに絵があり、表に無い効果は星にする", () => {
  // phi_dm の phi_dm.h の EF_* のうち、魔法に使う物 (罠と出現は除く)
  for (const ef of [...Array.from({ length: 36 }, (_, i) => i + 1), 40, 41, 42, 43, 44, 45, 61, 62, 63, 64, 65, 66, 67, 68])
    assert.ok(SPELL_PIXELS[ef], `ef=${ef}`);
  assert.deepEqual(spellPixels(99), SPELL_PIXELS[0].rows);
  // Hp と Mp のダメージは形が同じで色が違う
  assert.notDeepEqual(spellPixels(1), spellPixels(5));
});
