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

/** 送った移動の返事を待つ時間(ms)。サーバは 0.1 秒に1行処理し、地図はふつう 100ms 以内に届く */
export const PREDICT_WAIT_MS = 150;

export class Predictor {
  /** 返事の来ていない移動(送った順) */
  private queue: { dx: number; dy: number; at: number }[] = [];
  /** 最後に届いた地図の位置からの、予想したずれ */
  offset = { dx: 0, dy: 0 };
  private lastPos: string | null = null;
  private now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /** 行を送った時。北固定の go の時だけ数える */
  sent(text: string) {
    const m = /^go ([NESWnesw])$/.exec(text);
    if (m) this.queue.push({ ...STEP[m[1].toLowerCase()], at: this.now() });
  }

  /** 地図を受けた時。pos はその地図の位置。位置が変わっていれば、待っている移動の1つの返事とみなす */
  onMap(pos: string) {
    if (pos !== this.lastPos) this.queue.shift();
    this.lastPos = pos;
    this.offset = { dx: 0, dy: 0 };
  }

  /** 「進めません」を受けた時 */
  onCannotGo() {
    this.queue.shift();
  }

  /** 定期的に呼ぶ(サーバと同じ 0.1 秒ごと)。返事を待ちきった移動を1つ、進んだとみなす。ずれが変われば true */
  tick(): boolean {
    const head = this.queue[0];
    if (!head || this.now() - head.at < PREDICT_WAIT_MS) return false;
    this.queue.shift();
    this.offset = { dx: this.offset.dx + head.dx, dy: this.offset.dy + head.dy };
    return true;
  }

  reset() {
    this.queue = [];
    this.offset = { dx: 0, dy: 0 };
    this.lastPos = null;
  }
}
