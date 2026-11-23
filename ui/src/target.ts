// 対象を決めて殴る (最近の MMO のターゲット。#183)。対象は地図のキャラの番号 (#v6 O の C%04x) で覚える。
// 殴る時は、対象が隣なら向いてから hit、離れていれば対象へ 1 歩近づく (北固定の v6 の地図だけ)。サーバへは turn・go・hit を送るだけ

import { followStep } from "./follow.ts";
import type { MoveKey } from "./keys.ts";
import { stripTags } from "./mapPop.ts";
import { charCells, isBig, selfPos } from "./mapRender.ts";
import type { MapChar, MapEvent } from "./protocol";

/** 対象にしない種別。オブジェ (生物・看板・魔法の演出・動くオブジェ・動かないオブジェ。assets.rs の DEFAULT_GRA) */
const OBJECT_KINDS = new Set([0x80, 0x81, 0x82, 0x70, 0x75]);

/**
 * G で次の対象。自分・仲間・オブジェを除いた名前のあるキャラを近い順に並べ、今の対象の次を選ぶ (最後なら最初へ戻る)。
 * 居なければ null
 */
export function nextTarget(map: MapEvent, party: string[], current: number | null, aggro: Set<number> = new Set()): MapChar | null {
  const me = selfPos(map.width, map.height, map.style === "turn");
  const dist = (c: MapChar) => Math.abs(c.x - me.x) + Math.abs(c.y - me.y);
  // 自分か仲間を狙っている敵 (#v6 H の ag) を、距離より先に並べる
  const list = map.chars
    .filter((c) => (c.x !== me.x || c.y !== me.y) && stripTags(c.name) && !party.includes(stripTags(c.name)) && !OBJECT_KINDS.has(c.default))
    .sort((a, b) => Number(aggro.has(b.id)) - Number(aggro.has(a.id)) || dist(a) - dist(b) || a.id - b.id);
  if (list.length === 0) return null;
  const i = list.findIndex((c) => c.id === current);
  return list[(i + 1) % list.length];
}

export type AttackPlan =
  | { kind: "lost" }
  | { kind: "hit"; turn: string | null; near?: { x: number; y: number } }
  | { kind: "step"; key: MoveKey }
  | { kind: "wait" };

/**
 * 対象を殴る為に次にする事。対象が地図に居なければ lost。隣 (上下左右。2x2 の敵は体のどこか) なら、その方を向く turn と hit。
 * 回る地図は画面の上が前なので、右・後ろ・左を r・b・l で向く。離れていれば北固定の時だけ 1 歩近づき、他は wait
 */
/** キャラの向きの文字 → 地図の上の向き (B 上、R 右、F 下、L 左) */
const FACING: Record<string, { x: number; y: number }> = { B: { x: 0, y: -1 }, R: { x: 1, y: 0 }, F: { x: 0, y: 1 }, L: { x: -1, y: 0 } };

export function attackPlan(map: MapEvent, id: number, opts: { dodge?: boolean } = {}): AttackPlan {
  const c = map.chars.find((ch) => ch.id === id);
  if (!c) return { kind: "lost" };
  const turnMap = map.style === "turn";
  const me = selfPos(map.width, map.height, turnMap);
  const near = charCells(c, map.dir).find((p) => Math.abs(p.x - me.x) + Math.abs(p.y - me.y) === 1);
  // 自動攻撃の、こちらの攻撃の待ちの間 (dodge)。対象が隣でこちらを向いていれば、対象の横のマスへよける。
  // 敵は向いている先を殴るので、横へ動けば待ちの間の攻撃を外せる。待ちが明けたら殴る (北固定の v6 の地図だけ)
  if (near && opts.dodge && !turnMap && map.v6 && !isBig(c.gigant)) {
    const f = FACING[c.dir];
    if (f && c.x + f.x === me.x && c.y + f.y === me.y) {
      // 今の位置から敵の向きと直角に 1 歩。敵の斜めに出て、正面の線から外れる
      for (const side of [{ x: me.x + f.y, y: me.y + f.x }, { x: me.x - f.y, y: me.y - f.x }]) {
        const key = followStep(map, side, true);
        if (key && key !== "arrived") return { kind: "step", key };
      }
    }
    return { kind: "wait" };
  }
  if (near) {
    const d = `${near.x - me.x},${near.y - me.y}`;
    const turn = turnMap
      ? ({ "0,-1": null, "1,0": "r", "0,1": "b", "-1,0": "l" } as Record<string, string | null>)[d]
      : ({ "0,-1": "n", "1,0": "e", "0,1": "s", "-1,0": "w" } as Record<string, string>)[d];
    return { kind: "hit", turn: turn ?? null, near: { x: near.x - me.x, y: near.y - me.y } };
  }
  if (turnMap || !map.v6) return { kind: "wait" };
  // 1 歩で着く対象の隣のマスがあれば、対象の正面 (向いている先) より横や後ろを選ぶ。正面へ入ると殴られる
  const f = FACING[c.dir];
  if (f && !isBig(c.gigant)) {
    const around = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]
      .map((d) => ({ x: c.x + d.x, y: c.y + d.y, front: d.x === f.x && d.y === f.y }))
      .filter((p) => Math.abs(p.x - me.x) + Math.abs(p.y - me.y) === 1)
      .sort((a, b) => Number(a.front) - Number(b.front));
    for (const p of around) {
      const key = followStep(map, p, true);
      if (key && key !== "arrived") return { kind: "step", key };
    }
  }
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
