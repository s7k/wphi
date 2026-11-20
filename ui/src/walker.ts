// スムーズ移動の歩き方(docs/05-protocol-v6.md の 9)。#v6 G を送る v6 のサーバで、スムーズ移動が有効な時だけ使う。
// 押しているキー(と追尾移動の向き)から次の1歩を決め、その1歩を滑りきるまで次の1歩を始めない。
// キーのリピートは使わない。OS のリピートの速さで歩く速さが変わらないように、押している間かどうかだけを見る。
// 斜め(2つの向きのキーを同時に押す、追尾移動の斜め)は2行を続けて送り、地図は斜めに1回で滑らせる。
// 片方の向きが壁なら、呼ぶ側の pick でもう片方だけにし、縦横の1歩の時間で壁に沿って滑らせる
import type { MoveKey } from "./keys.ts";

/** 縦横の1歩と斜めの1歩(2行)を滑らせる時間(ms)。サーバは 0.1 秒に1行ずつ処理するので、それより短くしない */
export const WALK_MS = 100;
export const WALK_DIAGONAL_MS = 200;
/**
 * 返事の来ていない移動 (行) がこれ以上あれば、次の1歩を待つ。回線が遅い時にサーバより先へ行き過ぎない。
 * 返事は「往復 + サーバのティック待ち (0〜100ms)」で届くので、2 では往復 100ms を超えると歩みが止まった (#146)。
 * 斜めは 2 行と数える
 */
export const MAX_UNCONFIRMED = 3;
/**
 * 予定の時刻からこれより遅れて次の1歩を出す時は、拍を取り直す (返事待ちで止まった、離して押し直した等)。
 * 20ms ごとに見回るので、それより長く取る
 */
const BEAT_SLACK_MS = 40;
// 押しているかは keydown と keyup だけで決め、時間では離したとみなさない。OS のキーリピートは最後に押したキーにしか
// 掛からないので、上を押したまま右を押して離すと、上の keydown は届かなくなる(v0.1.87 まではそこで 700ms 後に止まった)。
// keyup が届かない時(窓のフォーカスが外れた時)は、呼ぶ側が clear() する
/**
 * 歩き出しの重さ (設定のスライダー、-2〜2)。押し始めの1歩の時間を WALK_MS の start 倍にし、押し続けた時間に比例して
 * 1 倍へ戻し、ramp ms で戻りきる。重い段は歩き出しが遅く、軽く押すと少しだけ進む。軽い段は歩き出しが速く、軽く押しても
 * 多く進む。サーバは 0.1 秒に1行しか処理しないので、押し続けた時の速さはどの段も同じ。0 (真ん中) は v0.1.110 までと同じ
 */
export const WEIGHTS: Record<number, { start: number; ramp: number }> = {
  [-2]: { start: 0.5, ramp: 300 },
  [-1]: { start: 0.75, ramp: 300 },
  0: { start: 1, ramp: 0 },
  1: { start: 1.75, ramp: 300 },
  2: { start: 2.5, ramp: 500 },
};

/** 押し始めてから elapsed ms 経った時の1歩の時間の倍率 */
export function rampFactor(elapsed: number, weight: number): number {
  const w = WEIGHTS[Math.max(-2, Math.min(2, Math.round(weight) || 0))];
  if (w.ramp <= 0) return w.start;
  return 1 + (w.start - 1) * Math.max(0, 1 - Math.max(0, elapsed) / w.ramp);
}

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

/** 1歩。at は滑らせ始める予定の時刻。押している間は前の1歩の終わりと同じで、見回りの遅れを次へ持ち越さない */
export type Step<M> = { keys: MoveKey[]; mods: M; ms: number; at: number };

export class Walker<M> {
  /** 押しているキー(キーのコード → 向きと修飾キー、最後に届いた時刻) */
  private held = new Map<string, { key: MoveKey; mods: M }>();
  private follow: { keys: MoveKey[]; mods: M; at: number } | null = null;
  /** 今の1歩を滑りきる時刻。次の1歩の予定の時刻でもある */
  private busyUntil = 0;
  /**
   * 最後に離したキーと時刻。予定の時刻より後に離したなら、その時刻にはまだ押していたので1歩を出す。
   * 20ms ごとの見回りがいつ来たかで、押した時間が同じでも歩数が変わった (#146)
   */
  private released: { key: MoveKey; mods: M; at: number } | null = null;
  /** キーを押し始めた時刻。押しているキーが無い所から押した時に決める (加速の起点) */
  private holdStart = 0;
  /** 歩き出しの重さ (設定のスライダー、-2〜2。WEIGHTS)。追尾移動には掛けない */
  weight = 0;
  private now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  keyDown(code: string, key: MoveKey, mods: M) {
    // 押しているキーが無い所から押したら、加速を最初からにする。押したまま別の向きを足しても続ける
    if (![...this.held.values()].some((h) => DIRS[h.key])) this.holdStart = this.now();
    this.held.set(code, { key, mods });
  }

  keyUp(code: string) {
    const h = this.held.get(code);
    if (h && DIRS[h.key]) this.released = { ...h, at: this.now() };
    this.held.delete(code);
  }

  /** 追尾移動の向き。届く間だけ歩く */
  setFollow(keys: MoveKey[], mods: M) {
    this.follow = { keys, mods, at: this.now() };
  }

  clear() {
    this.held.clear();
    this.follow = null;
    this.released = null;
  }

  /**
   * 次の1歩。滑らせている途中か、歩く向きが無いか、canStep が false なら null。
   * pick は送るキーを絞る(斜めのうち壁の側を除く)。返した時は、その1歩を滑りきるまで次を返さない
   */
  /**
   * canStep は歩けるか。数なら、あと何行送れるか (斜めは 2 行要る)
   */
  next(canStep: boolean | number, pick?: (keys: MoveKey[], mods: M) => MoveKey[]): Step<M> | null {
    const now = this.now();
    if (now < this.busyUntil) return null;
    if (this.follow && now - this.follow.at > FOLLOW_EXPIRE_MS) this.follow = null;
    // 予定の時刻に間に合っていれば、その時刻を1歩の始まりにする。遅れすぎていれば今から数え直す
    const at = now - this.busyUntil <= BEAT_SLACK_MS ? this.busyUntil : now;
    // 予定の時刻より後に離したキーは、その時刻にはまだ押していた
    const late = this.released && this.released.at > this.busyUntil && at === this.busyUntil ? this.released : null;
    const held = this.wantOf(this.held.values()) ?? (late && this.wantOf([late]));
    const want = held ?? this.want();
    if (!want) this.released = null;
    if (!want || canStep === false || canStep === 0) return null;
    const keys = pick ? pick(want.keys, want.mods) : want.keys;
    if (typeof canStep === "number" && keys.length > canStep) return null;
    this.released = null;
    // キーで歩く時は、押し始めからの時間で1歩を長くする (追尾移動はそのまま)
    const factor = held ? rampFactor(at - this.holdStart, this.weight) : 1;
    const step = { ...want, keys, ms: Math.round((keys.length > 1 ? WALK_DIAGONAL_MS : WALK_MS) * factor), at };
    this.busyUntil = at + step.ms;
    return step;
  }

  /** 押しているキーを足した向き。逆向きは打ち消す。キーが無ければ追尾移動の向き */
  private want(): Omit<Step<M>, "at"> | null {
    const held = this.wantOf(this.held.values());
    if (held) return held;
    const f = this.follow;
    if (!f) return null;
    const keys = f.keys.filter(walkable);
    return keys.length ? { keys, mods: f.mods, ms: keys.length > 1 ? WALK_DIAGONAL_MS : WALK_MS } : null;
  }

  /** キーを足した向き。逆向きは打ち消す */
  private wantOf(hs: Iterable<{ key: MoveKey; mods: M }>): Omit<Step<M>, "at"> | null {
    let dx = 0;
    let dy = 0;
    let mods: M | null = null;
    for (const h of hs) {
      const d = DIRS[h.key];
      if (!d) continue;
      dx += d.dx;
      dy += d.dy;
      mods = h.mods;
    }
    [dx, dy] = [Math.sign(dx), Math.sign(dy)];
    if (mods === null || !(dx || dy)) return null;
    const keys: MoveKey[] = [...(dy ? [dy < 0 ? "8" : "2"] : []), ...(dx ? [dx < 0 ? "4" : "6"] : [])] as MoveKey[];
    return { keys, mods, ms: keys.length > 1 ? WALK_DIAGONAL_MS : WALK_MS };
  }
}
