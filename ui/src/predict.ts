// 実験的: 位置の予想(表示のメニューで切り替える)。
// v5y は見え方が変わらないと、進んでも地図を送らない(phi_m57.rs の print_m57)。NPC のいない一様な所では、
// 拡張マップが止まって見える。送った go に地図も「進めません」も来なければ、進んだとみなして表示だけをずらす。
// サーバへは何も足さない。黙って進めなかった時(鍵の掛かった扉など)は、次に地図が来た時に本当の位置へ戻る。

/** 北固定の go の向き(go N は向きも変える、go n は向きを変えない。どちらも同じだけ進む) */
const STEP: Record<string, { dx: number; dy: number }> = {
  n: { dx: 0, dy: -1 },
  e: { dx: 1, dy: 0 },
  s: { dx: 0, dy: 1 },
  w: { dx: -1, dy: 0 },
};

/** 送った移動の返事を待つ時間(ms)の下限と上限。サーバは 0.1 秒に1行処理し、近ければ地図は 100ms 以内に届く。
 * 回線が遅いと地図が待つ時間より後に届き、予想で先へ進んだ分が戻って見える。なので届くまでの時間を測って待つ時間を延ばす */
export const PREDICT_WAIT_MS = 150;
const PREDICT_WAIT_MAX_MS = 1000;

export class Predictor {
  /** 返事の来ていない移動(送った順) */
  private queue: { dx: number; dy: number; at: number }[] = [];
  /** 最後に届いた地図の位置からの、予想したずれ */
  offset = { dx: 0, dy: 0 };
  private lastPos: string | null = null;
  /** 進んだとみなした移動のうち、最も古いものを送った時刻。後から地図が来たら、その移動の返事とみなす */
  private guessedAt: number | null = null;
  /** 移動を送ってから地図か「進めません」が届くまでの時間(ms)の平均 */
  private rtt = 0;
  private now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /** 行を送った時。北固定の go の時だけ数える */
  sent(text: string) {
    const m = /^go ([NESWnesw])$/.exec(text);
    if (m) this.queue.push({ ...STEP[m[1].toLowerCase()], at: this.now() });
  }

  /** 返事を待っている移動があるか */
  get waiting(): boolean {
    return this.queue.length > 0;
  }

  /** 返事を待つ時間。測った返事の時間に、サーバの1ティックと揺れの分を足す */
  get wait(): number {
    return Math.min(PREDICT_WAIT_MAX_MS, Math.max(PREDICT_WAIT_MS, this.rtt * 1.5 + 100));
  }

  /** 返事が届いた。進んだとみなした移動への返事なら true(待っている移動は残す) */
  private answered(): boolean {
    const at = this.guessedAt ?? this.queue[0]?.at;
    if (at !== undefined) this.rtt = this.rtt ? this.rtt * 0.7 + (this.now() - at) * 0.3 : this.now() - at;
    const guessed = this.guessedAt !== null;
    this.guessedAt = null;
    return guessed;
  }

  /** 地図を受けた時。pos はその地図の位置。位置が変わっていれば、待っている移動の1つの返事とみなす */
  onMap(pos: string) {
    if (pos !== this.lastPos && !this.answered()) this.queue.shift();
    this.lastPos = pos;
    this.offset = { dx: 0, dy: 0 };
  }

  /** 「進めません」を受けた時 */
  onCannotGo() {
    if (!this.answered()) this.queue.shift();
  }

  /** 定期的に呼ぶ(サーバと同じ 0.1 秒ごと)。返事を待ちきった移動を1つ、進んだとみなす。ずれが変われば true */
  tick(): boolean {
    const head = this.queue[0];
    if (!head || this.now() - head.at < this.wait) return false;
    this.queue.shift();
    this.guessedAt ??= head.at;
    this.offset = { dx: this.offset.dx + head.dx, dy: this.offset.dy + head.dy };
    return true;
  }

  reset() {
    this.queue = [];
    this.offset = { dx: 0, dy: 0 };
    this.lastPos = null;
    this.guessedAt = null;
  }
}
