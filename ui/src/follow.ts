// 仲間について行く (最近のネットゲームのオートフォロー)。北固定の v6 の地図で、仲間の位置へ見えている地図の上を歩く。
// 仲間の位置は、地図に見えていればその位置、見えていなければ #v6 P の dx・dy (同じ階の時だけ届く)。
// 道は、見えている地図の通れるマスを幅優先で探す。サーバへは何も足さない (go を送るだけ)。
// 仲間がゲートなどで一度に JUMP_CELLS より動いたら、仲間が最後に立っていたマスへ乗る (App.tsx の followTick)

/** 仲間の位置がこれより大きく 1 度に動いたら、ゲートやスイッチで飛んだとみなす */
export const JUMP_CELLS = 3;
import type { MoveKey } from "./keys.ts";
import { selfPos, UNKNOWN } from "./mapRender.ts";
import { BLOCKED } from "./predict.ts";
import { stripTags } from "./mapPop.ts";
import type { MapEvent, PartyMember } from "./protocol";

/** 北固定の 1 歩の向き (テンキー) と差 */
const STEPS: { key: MoveKey; dx: number; dy: number }[] = [
  { key: "8", dx: 0, dy: -1 },
  { key: "6", dx: 1, dy: 0 },
  { key: "2", dx: 0, dy: 1 },
  { key: "4", dx: -1, dy: 0 },
];

type Pos = { x: number; y: number };

/** 地図の上での仲間の位置。地図に見えていればそのキャラ、見えていなければ #v6 P の dx・dy。分からなければ null */
export function targetPos(map: MapEvent, name: string, party: PartyMember[]): Pos | null {
  const me = selfPos(map.width, map.height, false);
  const c = map.chars.find((ch) => stripTags(ch.name) === name && (ch.x !== me.x || ch.y !== me.y));
  if (c) return { x: c.x, y: c.y };
  const m = party.find((p) => p.name === name);
  if (m?.dx === undefined || m.dy === undefined) return null;
  return { x: me.x + m.dx, y: me.y + m.dy };
}

/** 地図の (x, y) を歩けるか。通れない地形、サーバの通れない印 (#v6 X)、見えない所は歩かない */
function walkable(map: MapEvent, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const cell = map.cells[y * map.width + x];
  return !cell.blocked && cell.chip !== UNKNOWN && !BLOCKED.has(cell.chip);
}

/**
 * 仲間の隣へ向かう次の 1 歩。隣 (縦横 1 マス) か同じマスに着いていれば "arrived"、道が無ければ null。
 * onto なら隣でなくそのマスの上に乗る (仲間がゲートで飛んだ時に、そのゲートへ乗る)。
 * 仲間が地図の外なら、仲間に一番近い地図の端のマスへ向かう
 */
export function followStep(map: MapEvent, target: Pos, onto = false): MoveKey | "arrived" | null {
  const me = selfPos(map.width, map.height, false);
  const dist = (p: Pos) => Math.abs(p.x - target.x) + Math.abs(p.y - target.y);
  const near = onto ? 0 : 1;
  if (dist(me) <= near) return "arrived";
  const inside = target.x >= 0 && target.y >= 0 && target.x < map.width && target.y < map.height;
  // 着けばよいマス。地図の中なら仲間の隣 (onto ならそのマス)、外なら仲間に一番近い歩けるマス
  const isGoal = (p: Pos) => (inside ? dist(p) <= near : false);
  const w = map.width;
  const first = new Map<number, MoveKey>();
  const queue: Pos[] = [me];
  const seen = new Set([me.y * w + me.x]);
  let best: { p: Pos; key: MoveKey } | null = null;
  while (queue.length) {
    const p = queue.shift()!;
    const key = first.get(p.y * w + p.x);
    if (key && isGoal(p)) return key;
    if (key && (!best || dist(p) < dist(best.p))) best = { p, key };
    for (const s of STEPS) {
      const q = { x: p.x + s.dx, y: p.y + s.dy };
      const i = q.y * w + q.x;
      // 乗るマス (ゲート) は、見た目が通れなくても目指す
      const goal = onto && q.x === target.x && q.y === target.y;
      if (seen.has(i) || (!goal && !walkable(map, q.x, q.y))) continue;
      seen.add(i);
      first.set(i, key ?? s.key);
      queue.push(q);
    }
  }
  // 隣まで行く道が無い (仲間が地図の外、壁の向こう) 時は、仲間に一番近づけるマスへ。今より近づけなければ止まる
  return best && dist(best.p) < dist(me) ? best.key : null;
}

/** 見失ってから、ついて行くのをやめるまでの時間 (ms)。別の世界へ移った、階が違う、パーティを抜けた */
export const LOST_MS = 3000;

/** 自分の歩いた座標 (predict.ts の walk) の上の位置。epoch は自分が飛ぶと変わる */
export type WalkPos = { x: number; y: number; epoch: number };
/** ついて行く間に覚えておく物。last は仲間を最後に見た位置、gate は仲間が飛んだ時に立っていた位置 */
export type FollowMemory = { last?: WalkPos; gate?: WalkPos; lostAt?: number };

/**
 * 今回見えた仲間の位置 target (地図の上。見えなければ null) から、向かう所を決める。
 * walk は自分の位置 (walk の座標)、me は地図の上の自分 (中央)。
 * 仲間が一度に JUMP_CELLS より動いたら、前に立っていたマスへ乗りに行く (onto)。自分も飛んだら (epoch が変わる) 仲間を探し直す
 */
export function followGoal(
  mem: FollowMemory,
  target: Pos | null,
  walk: WalkPos | undefined,
  me: Pos,
  now: number,
): { goal: Pos | null; onto: boolean; lost: boolean } {
  // 自分の歩いた位置はまだ分からない (ログインしてから #v6 G がまだ来ていない)。飛んだかは見ずに、見えている仲間へ向かう
  if (!walk) {
    if (target) mem.lostAt = undefined;
    else mem.lostAt ??= now;
    return target ? { goal: target, onto: false, lost: false } : { goal: null, onto: false, lost: now - (mem.lostAt ?? now) > LOST_MS };
  }
  const toWalk = (p: Pos): WalkPos => ({ x: walk.x + p.x - me.x, y: walk.y + p.y - me.y, epoch: walk.epoch });
  const toMap = (p: WalkPos): Pos => ({ x: me.x + p.x - walk.x, y: me.y + p.y - walk.y });
  if (mem.gate && mem.gate.epoch !== walk.epoch) mem.gate = undefined;
  if (target) {
    const t = toWalk(target);
    const last = mem.last;
    if (last && last.epoch === walk.epoch && Math.abs(t.x - last.x) + Math.abs(t.y - last.y) > JUMP_CELLS) mem.gate = last;
    mem.last = t;
    mem.lostAt = undefined;
  } else mem.lostAt ??= now;
  if (mem.gate) return { goal: toMap(mem.gate), onto: true, lost: false };
  if (target) return { goal: target, onto: false, lost: false };
  return { goal: null, onto: false, lost: now - (mem.lostAt ?? now) > LOST_MS };
}
