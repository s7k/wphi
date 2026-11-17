// 位置の予想。v6 の北固定で、#ex-pos の届く世界の時だけ使う。
// サーバは見え方が変わらないと、進んでも地図を送らない(phi_m57.rs の print_m57)。NPC のいない一様な所では、
// 地図が止まって見える。送った go に地図も「進めません」も来なければ、進んだとみなして最後の地図をずらす。
// サーバへは何も足さない。黙って進めなかった時は、次に地図が来た時に本当の位置へ戻る。
// 鍵の掛かった箱と扉は、サーバが音だけ鳴らして何も送らない(phi_dm/view.rs の move_chr)。地図も来ないので、
// 箱の上に乗って見え、その先へも進んで見える(#85)。なので行き先がこの2つなら進んだとみなさない。
// go のたびに #v6 G(動いた差)を送るサーバでは、それで確定する。待ちきった移動を進んだとみなすのは、返事が遅れた間だけになる。
import type { MapEvent } from "./protocol";
import { selfPos, UNKNOWN } from "./mapRender.ts";

/** 北固定の go の向き(go N は向きも変える、go n は向きを変えない。どちらも同じだけ進む) */
const STEP: Record<string, { dx: number; dy: number }> = {
  n: { dx: 0, dy: -1 },
  e: { dx: 1, dy: 0 },
  s: { dx: 0, dy: 1 },
  w: { dx: -1, dy: 0 },
};

/** 送った移動の返事を待つ時間(ms)の下限と上限。サーバは 0.1 秒に1行処理するので、近ければ地図は送ってから
 * 0〜100ms ほど(サーバのティックのどこで届いたかで揺れる)で届く。回線が遅いと地図が待つ時間より後に届き、
 * 予想で先へ進んだ分が戻って見える。なので最近の返事の時間の最大を測り、それより少し長く待つ */
export const PREDICT_WAIT_MS = 120;
/** 最近の返事の時間の最大に足す分 */
const WAIT_MARGIN_MS = 30;
/** 返事の時間を覚えておく数 */
const SAMPLES = 8;
const PREDICT_WAIT_MAX_MS = 1000;
/** サーバは1ティック(0.1 秒)に1行しか処理しないので、進んだとみなすのもこれより詰めない */
const SERVER_TICK_MS = 100;
/** 進んだとみなした移動に、これより後に来た地図は、その移動への返事の時間として測らない */
const LATE_MAP_MS = 400;
/** #v6 G を送るサーバで、これより待っても返事の来ない移動は捨てる(移動先の選択の最中の go は番号として読まれ、返事が来ない) */
const MOVED_GIVE_UP_MS = 1500;
/** スムーズ移動で1マスを滑らせる時間(ms)。サーバは 0.1 秒に1行ずつ処理するので、それに合わせる */
export const STEP_MS = 100;
/** 進んだとみなした分が外れて戻す時に滑らせる時間(ms) */
const CORRECT_MS = 80;
/** tick() を呼ぶ間隔。待ちきった時刻からの遅れはこれ以内 */
export const PREDICT_TICK_MS = 20;

/**
 * 移動。wall は通れない文字のマスへ向かって止めた1歩で、その行き先(walk の座標)。サーバが通せば隠し通路として覚える。
 * tunnel は隠し通路の中で、壁の文字のマスでも進んだとみなした1歩
 */
type Move = { dx: number; dy: number; at: number; wall?: { x: number; y: number }; tunnel?: boolean };
/** 黙って進めない地形。鍵の掛かった箱('%')と扉('{')。パスウォールなら進めるが、その時は地図が来て戻る */
const LOCKED = new Set(["%", "{"].map((c) => c.charCodeAt(0)));
/**
 * #v6 G を送るサーバで、進んだとみなさない地形。サーバが T_CWALL の印で止める物(phi_dm/view.rs の move_chr)のうち、
 * 地図の文字で分かる物。岩('@')、木('T')、檻('I')、窓('|')、ガラス('=')、見えない所('?')、鍵の掛かった箱と扉。
 * 壁('#'、'H')は隠し扉も同じ文字で届くが、ほとんどは壁なので止める。サーバが通した時は #v6 G で位置を直す。
 * 深い水と浅い水は同じ '_' なので止めない
 */
const BLOCKED = new Set(["%", "{", "@", "T", "I", "|", "=", "?", "#", "H"].map((c) => c.charCodeAt(0)));
/** 隠し扉と同じ文字で届く壁。サーバが通した所は隠し通路として覚える */
const WALLS = new Set(["#", "H"].map((c) => c.charCodeAt(0)));

const sum = (ms: Move[]) => ms.reduce((o, m) => ({ dx: o.dx + m.dx, dy: o.dy + m.dy }), { dx: 0, dy: 0 });

export class Predictor {
  /** 返事の来ていない移動(送った順) */
  private queue: Move[] = [];
  /** 返事を待ちきって、進んだとみなした移動(送った順)。地図か「進めません」が来るまで残す */
  private guessed: Move[] = [];
  /** 最後に届いた地図の位置 */
  private base: { x: number; y: number } | null = null;
  /** 最後に届いた地図 */
  private map: MapEvent | null = null;
  /** サーバが #v6 G を送るか */
  private acked = false;
  /** 最後に届いた地図の後に #v6 G で確かめた、動いた差 */
  private moved = { dx: 0, dy: 0 };
  /** #v6 G で確かめた、1 マスずつ歩いた分の合計。地図が来ても戻さない */
  private walked = { x: 0, y: 0 };
  /** 飛んだ時とやり直した時に増やす。walk の差を比べない印 */
  private epoch = 0;
  /** walk が最後に変わった時刻(now() の値)と、そこから walk の位置まで滑らせる時間(ms) */
  private walkedAt = 0;
  private walkMs = STEP_MS;
  /** 最後に通れない所へ向かった1歩の向きと時刻。地図はその場で揺らして見せる */
  private bumped: { dx: number; dy: number; at: number } | null = null;
  /** サーバが通した壁の文字のマス(隠し通路)。walk の座標で覚え、epoch が変わったら忘れる。自分が通った所だけ */
  private passed = new Set<string>();
  /** 隠し通路を通れた向き。同じ向きに続く壁の文字のマスも通れるとみなす。外れたら null */
  private tunnel: { dx: number; dy: number } | null = null;
  /** 移動を送ってから地図か「進めません」が届くまでの時間(ms)。新しい方の SAMPLES 個 */
  private samples: number[] = [];
  private lastGuess = -Infinity;
  private now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /** 最後に届いた地図の位置からの、予想したずれ */
  get offset(): { dx: number; dy: number } {
    const g = sum(this.guessed);
    return { dx: this.moved.dx + g.dx, dy: this.moved.dy + g.dy };
  }

  /** サーバが #v6 G を送るか */
  get confirms(): boolean {
    return this.acked;
  }

  /** 歩いた分を足した位置(進んだとみなした分も含む)。#v6 G を送るサーバだけ */
  get walk():
    | { x: number; y: number; epoch: number; at: number; ms: number; bump?: { dx: number; dy: number; at: number } }
    | undefined {
    if (!this.acked) return undefined;
    const g = sum(this.guessed);
    const w = { x: this.walked.x + g.dx, y: this.walked.y + g.dy, epoch: this.epoch, at: this.walkedAt, ms: this.walkMs };
    return this.bumped ? { ...w, bump: this.bumped } : w;
  }

  /** 進んだとみなしたが、#v6 G の返事がまだ来ていない移動の数 */
  get unconfirmed(): number {
    return this.guessed.length;
  }

  /**
   * スムーズ移動で1歩を送った時(ui/src/walker.ts)。返事を待たずに進んだとみなし、その位置まで ms で滑らせる。
   * 前に送って返事を待っている移動も、送った順を崩さないよう進んだとみなす側へ移す
   */
  walkStep(text: string, ms: number) {
    const m = /^go ([NESWnesw])$/.exec(text);
    if (!m) return;
    const now = this.now();
    this.guessed.push(...this.queue.splice(0));
    const step: Move = { ...STEP[m[1].toLowerCase()], at: now };
    this.lastGuess = now;
    const g = sum(this.guessed);
    const to = { x: this.walked.x + g.dx + step.dx, y: this.walked.y + g.dy + step.dy };
    const wall = this.blocks(step, WALLS);
    const inTunnel = wall && this.tunnel?.dx === step.dx && this.tunnel?.dy === step.dy;
    if (!wall) this.tunnel = null;
    if (this.blocks(step, BLOCKED) && !this.passed.has(`${to.x},${to.y}`) && !inTunnel) {
      // 通れない所へは進まず、その場で揺らす。#v6 G 0 0 と順番を合わせる為、動かない1歩として残す
      this.guessed.push({ dx: 0, dy: 0, at: now, wall: wall ? to : undefined });
      this.bumped = { dx: step.dx, dy: step.dy, at: now };
      return;
    }
    // 通った隠し通路と、隠し通路の中で同じ向きに続く壁は進む
    this.guessed.push(wall ? { ...step, tunnel: true } : step);
    this.walkedAt = now;
    this.walkMs = ms;
  }

  /** 返事を待っている移動があるか */
  get waiting(): boolean {
    return this.queue.length > 0;
  }

  /** 返事を待つ時間。平均で待つと、ティックの遅い側で届く地図を待ちきれず、半分ほどで外す */
  get wait(): number {
    const max = Math.max(0, ...this.samples) + WAIT_MARGIN_MS;
    return Math.min(PREDICT_WAIT_MAX_MS, Math.max(PREDICT_WAIT_MS, max));
  }

  private measure(m: Move) {
    this.samples = [...this.samples, this.now() - m.at].slice(-SAMPLES);
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
  onMap(pos: string | null, map: MapEvent | null = null) {
    this.map = map;
    if (this.acked) {
      // #v6 G は地図より先に届くので、地図は返事の来た移動を全部含む。返事の来ていない移動はそのまま。
      // 位置は使わないので、#ex-pos の届かない世界でもよい
      this.moved = { dx: 0, dy: 0 };
      return;
    }
    if (!pos) return;
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
    const fromGuessed = Math.min(k, this.guessed.length);
    // 進んだとみなした移動にだけ地図が来た時は、回線が遅いのか、後で見え方が変わったのか分からない。
    // 後者を測ると何秒にもなり、待つ時間が上限まで延びて長押しが1歩 1 秒になるので、回線の遅れらしい時だけ測る
    const last = all[k - 1];
    if (k > fromGuessed || this.now() - last.at <= LATE_MAP_MS) this.measure(last);
    this.guessed.splice(0, fromGuessed);
    this.queue.splice(0, k - fromGuessed);
  }

  /** 「進めません」を受けた時。サーバは順に処理するので、一番古い返事の来ていない移動への返事 */
  onCannotGo() {
    if (this.acked) return;
    if (this.guessed.shift()) return;
    const m = this.queue.shift();
    if (m) this.measure(m);
  }

  /**
   * #v6 G を受けた時。サーバは順に処理するので、一番古い返事の来ていない移動への返事。ずれが変われば true。
   * 1 マスより大きい差(スイッチやゲートで飛んだ)は、次の地図を待つ
   */
  onMoved(dx: number, dy: number): boolean {
    const before = this.offset;
    this.acked = true;
    const answered = this.guessed.shift();
    if (!answered) {
      const m = this.queue.shift();
      if (m) this.measure(m);
    }
    const unit = Math.abs(dx) + Math.abs(dy) === 1;
    if (answered?.wall && unit) {
      // 止めた壁の文字のマスをサーバが通した。隠し通路として覚え、同じ向きに続く壁も通れるとみなす
      this.passed.add(`${answered.wall.x},${answered.wall.y}`);
      this.tunnel = { dx, dy };
    } else if (answered?.tunnel && unit) this.passed.add(`${this.walked.x + dx},${this.walked.y + dy}`);
    else if (answered?.tunnel) this.tunnel = null;
    if (unit) {
      this.moved = { dx: this.moved.dx + dx, dy: this.moved.dy + dy };
      this.walked = { x: this.walked.x + dx, y: this.walked.y + dy };
    } else if (dx || dy) {
      this.moved = { dx: 0, dy: 0 };
      this.guessed = [];
      this.epoch++;
      this.passed.clear();
      this.tunnel = null;
    }
    const after = this.offset;
    const changed = before.dx !== after.dx || before.dy !== after.dy;
    if (changed) {
      // 進んだとみなした分が外れた時の戻しは短く滑らせる
      this.walkedAt = this.now();
      this.walkMs = CORRECT_MS;
    }
    return changed;
  }

  /** PREDICT_TICK_MS ごとに呼ぶ。返事を待ちきった移動を1つ、進んだとみなす。ずれが変われば true */
  tick(): boolean {
    const head = this.queue[0];
    const now = this.now();
    if (this.acked) {
      const oldest = this.guessed[0] ?? head;
      if (oldest && now - oldest.at > MOVED_GIVE_UP_MS) {
        if (this.guessed.shift()) {
          this.walkedAt = now;
          this.walkMs = CORRECT_MS;
          return true;
        }
        this.queue.shift();
        return false;
      }
    }
    if (!head || now - head.at < this.wait || now - this.lastGuess < SERVER_TICK_MS) return false;
    this.lastGuess = now;
    const m = this.queue.shift()!;
    // #v6 G を送るサーバは通れない所へも 0 0 を返すので、順番を合わせる為に動かない1歩として残す。
    // 送らないサーバは、壁では「進めません」が届くので、黙って止まる鍵の掛かった所だけを捨てる
    if (this.acked ? this.blocks(m, BLOCKED) : this.blocks(m, LOCKED)) {
      if (this.acked) this.guessed.push({ dx: 0, dy: 0, at: m.at });
      return false;
    }
    this.guessed.push(m);
    this.walkedAt = now;
    this.walkMs = STEP_MS;
    return true;
  }

  /** 進んだとみなした分の先へ m で進む先が、最後の地図で set の地形か */
  private blocks(m: Move, set: Set<number>): boolean {
    const map = this.map;
    if (!map) return false;
    const me = selfPos(map.width, map.height, false);
    const o = this.offset;
    const x = me.x + o.dx + m.dx;
    const y = me.y + o.dy + m.dy;
    if (x < 0 || x >= map.width || y < 0 || y >= map.height) return false;
    return set.has(map.cells[y * map.width + x].chip);
  }

  reset() {
    this.queue = [];
    this.guessed = [];
    this.base = null;
    this.map = null;
    this.acked = false;
    this.bumped = null;
    this.passed.clear();
    this.tunnel = null;
    this.moved = { dx: 0, dy: 0 };
    this.epoch++;
    this.lastGuess = -Infinity;
  }
}

/**
 * 予想した位置の地図。最後に届いた v6 の北固定の地図を (dx, dy) ずらし、新しく入る端を '?' で埋める。
 * 1 マスなら '?' の端は窓の外の外周に入り(mapRender.ts の viewArea)、窓には外周にあった地形が入る。
 * 自キャラは中央に残し、他のキャラは地形と一緒にずらす。v6 の北固定でなければそのまま
 */
export function predictedMap(map: MapEvent, dx: number, dy: number): MapEvent {
  if (!map.v6 || map.style === "turn" || (dx === 0 && dy === 0)) return map;
  const { width: w, height: h } = map;
  const me = selfPos(w, h, false);
  const inside = (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < h;
  const cells = Array.from({ length: w * h }, (_, i) => {
    const x = (i % w) + dx;
    const y = Math.floor(i / w) + dy;
    return inside(x, y) ? map.cells[y * w + x] : { chip: UNKNOWN, attr: 0 };
  });
  const chars = map.chars.flatMap((c) => {
    if (c.x === me.x && c.y === me.y) return [c];
    const x = c.x - dx;
    const y = c.y - dy;
    return inside(x, y) ? [{ ...c, x, y }] : [];
  });
  return { ...map, cells, chars, pos: map.pos && { x: map.pos.x + dx, y: map.pos.y + dy } };
}
