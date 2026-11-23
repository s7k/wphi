// 対象を決めて殴る (最近の MMO のターゲット。#183)。対象は地図のキャラの番号 (#v6 O の C%04x) で覚える。
// 殴る時は、対象が隣なら向いてから hit、離れていれば対象へ 1 歩近づく (北固定の v6 の地図だけ)。サーバへは turn・go・hit を送るだけ

import { followStep } from "./follow.ts";
import type { MoveKey } from "./keys.ts";
import { stripTags } from "./mapPop.ts";
import { charCells, selfPos } from "./mapRender.ts";
import type { MapChar, MapEvent } from "./protocol";

/** 対象にしない種別。オブジェ (生物・看板・魔法の演出・動くオブジェ・動かないオブジェ。assets.rs の DEFAULT_GRA) */
const OBJECT_KINDS = new Set([0x80, 0x81, 0x82, 0x70, 0x75]);

/**
 * G で次の対象。自分・仲間・オブジェを除いた名前のあるキャラを近い順に並べ、今の対象の次を選ぶ (最後なら最初へ戻る)。
 * 居なければ null
 */
export function nextTarget(map: MapEvent, party: string[], current: number | null): MapChar | null {
  const me = selfPos(map.width, map.height, map.style === "turn");
  const dist = (c: MapChar) => Math.abs(c.x - me.x) + Math.abs(c.y - me.y);
  const list = map.chars
    .filter((c) => (c.x !== me.x || c.y !== me.y) && stripTags(c.name) && !party.includes(stripTags(c.name)) && !OBJECT_KINDS.has(c.default))
    .sort((a, b) => dist(a) - dist(b) || a.id - b.id);
  if (list.length === 0) return null;
  const i = list.findIndex((c) => c.id === current);
  return list[(i + 1) % list.length];
}

export type AttackPlan = { kind: "lost" } | { kind: "hit"; turn: string | null } | { kind: "step"; key: MoveKey } | { kind: "wait" };

/**
 * 対象を殴る為に次にする事。対象が地図に居なければ lost。隣 (上下左右。2x2 の敵は体のどこか) なら、その方を向く turn と hit。
 * 回る地図は画面の上が前なので、右・後ろ・左を r・b・l で向く。離れていれば北固定の時だけ 1 歩近づき、他は wait
 */
export function attackPlan(map: MapEvent, id: number): AttackPlan {
  const c = map.chars.find((ch) => ch.id === id);
  if (!c) return { kind: "lost" };
  const turnMap = map.style === "turn";
  const me = selfPos(map.width, map.height, turnMap);
  const near = charCells(c, map.dir).find((p) => Math.abs(p.x - me.x) + Math.abs(p.y - me.y) === 1);
  if (near) {
    const d = `${near.x - me.x},${near.y - me.y}`;
    const turn = turnMap
      ? ({ "0,-1": null, "1,0": "r", "0,1": "b", "-1,0": "l" } as Record<string, string | null>)[d]
      : ({ "0,-1": "n", "1,0": "e", "0,1": "s", "-1,0": "w" } as Record<string, string>)[d];
    return { kind: "hit", turn: turn ?? null };
  }
  if (turnMap || !map.v6) return { kind: "wait" };
  // 対象が同じマスに乗っている時 (敵の方から重なってきた時) は、隣の通れるマスへよける。hit は隣にしか当たらない
  if (charCells(c, map.dir).some((p) => p.x === me.x && p.y === me.y)) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const key = followStep(map, { x: me.x + dx, y: me.y + dy }, true);
      if (key && key !== "arrived") return { kind: "step", key };
    }
    return { kind: "wait" };
  }
  const step = followStep(map, { x: c.x, y: c.y });
  return step && step !== "arrived" ? { kind: "step", key: step } : { kind: "wait" };
}
