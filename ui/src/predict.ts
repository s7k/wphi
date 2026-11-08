// 拡張マップの付属: 位置の予想(表示のメニューの「拡張マップ」で切り替える)。
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

type Move = { dx: number; dy: number; at: number };
const sum = (ms: Move[]) => ms.reduce((o, m) => ({ dx: o.dx + m.dx, dy: o.dy + m.dy }), { dx: 0, dy: 0 });

export class Predictor {
  /** 返事の来ていない移動(送った順) */
  private queue: Move[] = [];
  /** 返事を待ちきって、進んだとみなした移動(送った順)。地図か「進めません」が来るまで残す */
  private guessed: Move[] = [];
  /** 最後に届いた地図の位置 */
  private base: { x: number; y: number } | null = null;
  /** 移動を送ってから地図か「進めません」が届くまでの時間(ms)の平均 */
  private rtt = 0;
  private now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /** 最後に届いた地図の位置からの、予想したずれ */
  get offset(): { dx: number; dy: number } {
    return sum(this.guessed);
  }

  /** 返事を待っている移動があるか */
  get waiting(): boolean {
    return this.queue.length > 0;
  }

  /** 返事を待つ時間。測った返事の時間に、サーバの1ティックと揺れの分を足す */
  get wait(): number {
    return Math.min(PREDICT_WAIT_MAX_MS, Math.max(PREDICT_WAIT_MS, this.rtt * 1.5 + 100));
  }

  private measure(m: Move) {
    const ms = this.now() - m.at;
    this.rtt = this.rtt ? this.rtt * 0.7 + ms * 0.3 : ms;
  }

  /** 行を送った時。北固定の go の時だけ数える */
  sent(text: string) {
    const m = /^go ([NESWnesw])$/.exec(text);
    if (m) this.queue.push({ ...STEP[m[1].toLowerCase()], at: this.now() });
  }

  /**
   * 地図を受けた時。pos はその地図の位置("x,y,…")。
   * 前の地図からのずれと、古い方から足した移動のずれが合う所までを、返事の来た移動とみなす。
   * 一様な所では進んでも地図が来ないので、地図は「進んだとみなした移動」と「待っている移動」のどちらへの返事にもなる
   */
  onMap(pos: string) {
    const [x, y] = pos.split(",").map(Number);
    const prev = this.base;
    this.base = { x, y };
    if (prev && prev.x === x && prev.y === y) {
      // 位置の変わらない地図(他のキャラが動いた)。進んだとみなした分は、まだ進んでいない
      this.guessed = [];
      return;
    }
    const all = [...this.guessed, ...this.queue];
    let k = 0;
    if (prev) {
      const d = { dx: x - prev.x, dy: y - prev.y };
      for (let i = 1; i <= all.length && !k; i++) {
        const s = sum(all.slice(0, i));
        if (s.dx === d.dx && s.dy === d.dy) k = i;
      }
    }
    if (!k) {
      // 合わない(ワープ・押し戻しなど)。本当の位置に戻し、待っている移動の1つの返事とみなす
      this.guessed = [];
      this.queue.shift();
      return;
    }
    this.measure(all[k - 1]);
    const fromGuessed = Math.min(k, this.guessed.length);
    this.guessed.splice(0, fromGuessed);
    this.queue.splice(0, k - fromGuessed);
  }

  /** 「進めません」を受けた時。サーバは順に処理するので、一番古い返事の来ていない移動への返事 */
  onCannotGo() {
    const m = this.guessed.shift() ?? this.queue.shift();
    if (m) this.measure(m);
  }

  /** 定期的に呼ぶ(サーバと同じ 0.1 秒ごと)。返事を待ちきった移動を1つ、進んだとみなす。ずれが変われば true */
  tick(): boolean {
    const head = this.queue[0];
    if (!head || this.now() - head.at < this.wait) return false;
    this.guessed.push(this.queue.shift()!);
    return true;
  }

  reset() {
    this.queue = [];
    this.guessed = [];
    this.base = null;
  }
}
