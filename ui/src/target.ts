// 対象を決めて殴る (最近の MMO のターゲット。#183)。対象は地図のキャラの番号 (#v6 O の C%04x) で覚える。
// 殴る時は、対象が隣なら向いてから hit、離れていれば対象へ 1 歩近づく (北固定の v6 の地図だけ)。サーバへは turn・go・hit を送るだけ

import { followStep, walkable } from "./follow.ts";
import type { MoveKey } from "./keys.ts";
import { stripTags } from "./mapPop.ts";
import { charCells, selfPos } from "./mapRender.ts";
import type { MapChar, MapEvent } from "./protocol";

/** 対象にしない種別。オブジェ (生物・看板・魔法の演出・動くオブジェ・動かないオブジェ。assets.rs の DEFAULT_GRA) */
const OBJECT_KINDS = new Set([0x80, 0x81, 0x82, 0x70, 0x75]);

/**
 * Shift+G で次の対象。自分・仲間・傭兵・オブジェを除いた名前のあるキャラを近い順に並べ、今の対象の次を選ぶ (最後なら最初へ戻る)。
 * 傭兵は #v6 H の merc で分かる (mercs)。low は設定で外すカルマの低い NPC (#v6 H の low)。居なければ null
 */
export function nextTarget(
  map: MapEvent,
  party: string[],
  current: number | null,
  aggro: Set<number> = new Set(),
  mercs: Set<number> = new Set(),
  low: Set<number> = new Set(),
): MapChar | null {
  const me = selfPos(map.width, map.height, map.style === "turn");
  const dist = (c: MapChar) => Math.abs(c.x - me.x) + Math.abs(c.y - me.y);
  // 自分か仲間を狙っている敵 (#v6 H の ag) を、距離より先に並べる
  const list = map.chars
    .filter(
      (c) =>
        (c.x !== me.x || c.y !== me.y) &&
        stripTags(c.name) &&
        !party.includes(stripTags(c.name)) &&
        !mercs.has(c.id) &&
        !low.has(c.id) &&
        !OBJECT_KINDS.has(c.default),
    )
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
  const body = charCells(c, map.dir);
  const inBody = (p: { x: number; y: number }) => body.some((b) => b.x === p.x && b.y === p.y);
  const dist = (p: { x: number; y: number }) => Math.abs(p.x - me.x) + Math.abs(p.y - me.y);
  const near = body.find((p) => dist(p) === 1);
  // 対象の正面のマス (体の向いている先で、体の外)。2x2 の敵は 2 マス
  const f = FACING[c.dir];
  const isFront = (p: { x: number; y: number }) => !!f && inBody({ x: p.x - f.x, y: p.y - f.y }) && !inBody(p);
  // 1 歩で入れる歩けるマスへの 1 歩。壁の先 (followStep の onto はゲートの為に壁でも 1 歩を返す) は選ばない
  const stepTo = (p: { x: number; y: number }) => {
    if (dist(p) !== 1 || !walkable(map, p.x, p.y) || inBody(p)) return null;
    const key = followStep(map, p, true);
    return key && key !== "arrived" ? key : null;
  };
  // 自動攻撃の、こちらの攻撃の待ちの間 (dodge)。対象が隣でこちらを向いていれば、正面から外れる横のマスへよける。
  // 敵は向いている先を殴るので、横へ動けば待ちの間の攻撃を外せる。よける先が壁なら、その場で殴る (北固定の v6 の地図だけ)
  if (near && opts.dodge && !turnMap && map.v6) {
    if (!isFront(me)) return { kind: "wait" };
    for (const side of f ? [{ x: me.x + f.y, y: me.y + f.x }, { x: me.x - f.y, y: me.y - f.x }] : []) {
      const key = isFront(side) ? null : stepTo(side);
      if (key) return { kind: "step", key };
    }
  }
  if (near) {
    const d = `${near.x - me.x},${near.y - me.y}`;
    const turn = turnMap
      ? ({ "0,-1": null, "1,0": "r", "0,1": "b", "-1,0": "l" } as Record<string, string | null>)[d]
      : ({ "0,-1": "n", "1,0": "e", "0,1": "s", "-1,0": "w" } as Record<string, string>)[d];
    return { kind: "hit", turn: turn ?? null, near: { x: near.x - me.x, y: near.y - me.y } };
  }
  if (turnMap || !map.v6) return { kind: "wait" };
  // 1 歩で着く対象の隣 (体のどのマスの縦横の隣でも良い) があれば、正面より横や後ろを選ぶ。正面へ入ると殴られる
  const around = body
    .flatMap((b) => [{ x: b.x, y: b.y - 1 }, { x: b.x + 1, y: b.y }, { x: b.x, y: b.y + 1 }, { x: b.x - 1, y: b.y }])
    .filter((p) => !inBody(p))
    .sort((a, b) => Number(isFront(a)) - Number(isFront(b)));
  for (const p of around) {
    const key = stepTo(p);
    if (key) return { kind: "step", key };
  }
  // 対象が同じマスに乗っている時 (敵の方から重なってきた時) は、隣の通れるマスへよける。hit は隣にしか当たらない
  if (inBody(me)) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const key = stepTo({ x: me.x + dx, y: me.y + dy });
      if (key) return { kind: "step", key };
    }
    return { kind: "wait" };
  }
  // 遠ければ、体の近いマスから順に、隣まで行く道を探す (2x2 の敵は北西の角の隣が壁でも、他の角の隣へ回る)
  for (const b of [...body].sort((a, b) => dist(a) - dist(b))) {
    const step = followStep(map, b);
    if (step && step !== "arrived") return { kind: "step", key: step };
  }
  return { kind: "wait" };
}
