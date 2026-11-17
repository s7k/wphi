// スムーズ移動の歩き方(docs/05-protocol-v6.md の 10)。#v6 G を送る v6 のサーバで、スムーズ移動が有効な時だけ使う。
// 押しているキー(と追尾移動の向き)から次の1歩を決め、その1歩を滑りきるまで次の1歩を始めない。
// キーのリピートは使わない。OS のリピートの速さで歩く速さが変わらないように、押している間かどうかだけを見る。
// 斜め(2つの向きのキーを同時に押す、追尾移動の斜め)は2行を続けて送り、地図は斜めに1回で滑らせる
import type { MoveKey } from "./keys.ts";

/** 縦横の1歩と斜めの1歩(2行)を滑らせる時間(ms)。サーバは 0.1 秒に1行ずつ処理するので、それより短くしない */
export const WALK_MS = 100;
export const WALK_DIAGONAL_MS = 200;
/** 進んだとみなして返事の来ていない移動がこれ以上あれば、次の1歩を待つ。回線が遅い時にサーバより先へ行き過ぎない */
export const MAX_UNCONFIRMED = 2;
// 押しているかは keydown と keyup だけで決め、時間では離したとみなさない。OS のキーリピートは最後に押したキーにしか
// 掛からないので、上を押したまま右を押して離すと、上の keydown は届かなくなる(v0.1.87 まではそこで 700ms 後に止まった)。
// keyup が届かない時(窓のフォーカスが外れた時)は、呼ぶ側が clear() する
/** 追尾移動の向きが届かなくなってから止めるまでの時間(ms)。地図は 30ms ごとに送る */
const FOLLOW_EXPIRE_MS = 120;

/** 向き。上下左右とテンキーの 2・4・6・8。他(5・7・9 はその場で向きを変える)は歩かない */
const DIRS: Partial<Record<MoveKey, { dx: number; dy: number }>> = {
  "8": { dx: 0, dy: -1 },
  up: { dx: 0, dy: -1 },
  "2": { dx: 0, dy: 1 },
  down: { dx: 0, dy: 1 },
  "4": { dx: -1, dy: 0 },
  left: { dx: -1, dy: 0 },
  "6": { dx: 1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** 歩くキーか */
export const walkable = (key: MoveKey) => key in DIRS;

export type Step<M> = { keys: MoveKey[]; mods: M; ms: number };

export class Walker<M> {
  /** 押しているキー(キーのコード → 向きと修飾キー、最後に届いた時刻) */
  private held = new Map<string, { key: MoveKey; mods: M }>();
  private follow: { keys: MoveKey[]; mods: M; at: number } | null = null;
  /** 今の1歩を滑りきる時刻 */
  private busyUntil = 0;
  private now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  keyDown(code: string, key: MoveKey, mods: M) {
    this.held.set(code, { key, mods });
  }

  keyUp(code: string) {
    this.held.delete(code);
  }

  /** 追尾移動の向き。届く間だけ歩く */
  setFollow(keys: MoveKey[], mods: M) {
    this.follow = { keys, mods, at: this.now() };
  }

  clear() {
    this.held.clear();
    this.follow = null;
  }

  /**
   * 次の1歩。滑らせている途中か、歩く向きが無いか、canStep が false なら null。
   * 返した時は、その1歩を滑りきるまで次を返さない
   */
  next(canStep: boolean): Step<M> | null {
    const now = this.now();
    if (now < this.busyUntil) return null;
    if (this.follow && now - this.follow.at > FOLLOW_EXPIRE_MS) this.follow = null;
    const want = this.want();
    if (!want || !canStep) return null;
    this.busyUntil = now + want.ms;
    return want;
  }

  /** 押しているキーを足した向き。逆向きは打ち消す。キーが無ければ追尾移動の向き */
  private want(): Step<M> | null {
    let dx = 0;
    let dy = 0;
    let mods: M | null = null;
    for (const h of this.held.values()) {
      const d = DIRS[h.key];
      if (!d) continue;
      dx += d.dx;
      dy += d.dy;
      mods = h.mods;
    }
    [dx, dy] = [Math.sign(dx), Math.sign(dy)];
    if (mods !== null && (dx || dy)) {
      const keys: MoveKey[] = [...(dy ? [dy < 0 ? "8" : "2"] : []), ...(dx ? [dx < 0 ? "4" : "6"] : [])] as MoveKey[];
      return { keys, mods, ms: keys.length > 1 ? WALK_DIAGONAL_MS : WALK_MS };
    }
    const f = this.follow;
    if (!f) return null;
    const keys = f.keys.filter(walkable);
    return keys.length ? { keys, mods: f.mods, ms: keys.length > 1 ? WALK_DIAGONAL_MS : WALK_MS } : null;
  }
}
