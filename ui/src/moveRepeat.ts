// 移動キーを押し続けた時のリピート移動(Philly の CharacterCommon.cpp classMoveCommand)。
//
// v5y サーバは ex-move-recv を返さないので、Philly の「ex-move-recv が無効な時」の動きにしてある。
// - キーを押した瞬間に1回送る
// - REPEAT_START_MS 押し続けるとリピートに入り、#map-iv 10 を送る
// - リピート中は、送った移動の分のマップを受け取るたびに次の1歩を送る。回転は繰り返さない
// - 「進めません.」を受けた時は、押しているキーの方向が変わっていれば送る
// - 2つのキーで斜めに押すと、2方向を交互に送る
// - 全部のキーを離して REPEAT_END_MS でリピートを終え、#map-iv を元に戻す
// - マップを左クリックした時は、その向きへすぐ送ってリピートに入る。押している間はマウスの向きへ進む(MouseDown)
import { moveCommand, type Mods, type MoveKey } from "./keys.ts";

/** Philly.ini の RepeatModeStartTime / RepeatModeEndTime の既定値 */
const REPEAT_START_MS = 200;
const REPEAT_END_MS = 100;
/** リピート中の #map-iv と、普段の値(session.rs のログイン時の送信と同じ) */
const MAP_IV_REPEAT = 10;
const MAP_IV_NORMAL = 2;

const OPPOSITE: [MoveKey, MoveKey][] = [
  ["2", "8"],
  ["4", "6"],
  ["down", "up"],
  ["left", "right"],
];

/** 斜めとして扱う組み合わせ(Philly の GetMoveKeyState の「相反するキーが押されていない」組) */
const DIAGONAL: [MoveKey, MoveKey][] = [
  ["2", "4"],
  ["2", "6"],
  ["8", "4"],
  ["8", "6"],
  ["down", "left"],
  ["down", "right"],
  ["up", "left"],
  ["up", "right"],
];

export class MoveRepeat {
  private held = new Set<MoveKey>();
  /** マップの上で左ボタンを押している間の向き */
  private mouse: MoveKey[] = [];
  private mods: Mods = "none";
  private repeat = false;
  private startAt = Infinity;
  private endAt = Infinity;
  /** 送ったのにまだマップが返っていない移動の数(Philly の CommandSendMapDispCount) */
  private pending = 0;
  /** 最後に送った方向(Philly の MoveDirectionBak) */
  private last: MoveKey | null = null;

  private send: (text: string) => void;
  private northFix: () => boolean;
  private now: () => number;

  constructor(send: (text: string) => void, northFix: () => boolean, now: () => number = () => performance.now()) {
    this.send = send;
    this.northFix = northFix;
    this.now = now;
  }

  keyDown(key: MoveKey, mods: Mods, isRepeat: boolean) {
    this.mods = mods;
    if (!this.held.has(key)) this.startAt = this.now() + REPEAT_START_MS;
    this.held.add(key);
    this.endAt = Infinity;
    if (isRepeat) return;
    if (this.repeat && this.endAt < this.now()) this.setRepeat(false);
    this.last = key;
    this.sendMove(key, true);
  }

  keyUp(key: MoveKey) {
    this.held.delete(key);
    if (this.held.size === 0) {
      this.startAt = Infinity;
      this.endAt = this.now() + REPEAT_END_MS;
    }
  }

  /** 窓がフォーカスを失った時。押していたキーとマウスは離したことにする */
  releaseAll() {
    for (const k of [...this.held]) this.keyUp(k);
    this.mouseUp();
  }

  /** マップの上で左ボタンを押した時(Philly の classMoveCommand::MouseDown) */
  mouseDown(keys: MoveKey[]) {
    this.mouse = keys;
    this.mods = "none";
    this.endAt = Infinity;
    const key = this.pick();
    if (key) {
      this.last = key;
      this.sendMove(key, true);
    }
    // Philly は送った後に CommandSendMapDispCount を 2 にしてからリピートに入る
    this.pending = 2;
    this.setRepeat(true);
  }

  /** 左ボタンを押したままマウスを動かした時 */
  mouseMove(keys: MoveKey[]) {
    if (this.mouse.length > 0 && keys.length > 0) this.mouse = keys;
  }

  mouseUp() {
    if (this.mouse.length === 0) return;
    this.mouse = [];
    if (this.held.size === 0) this.endAt = this.now() + REPEAT_END_MS;
  }

  /** 定期的に呼ぶ。リピートの開始と終了を決める(Philly の RepeatCheckWhenNoRecv) */
  tick() {
    const now = this.now();
    if (this.repeat) {
      if (this.held.size === 0 && this.mouse.length === 0 && this.endAt < now) this.setRepeat(false);
      return;
    }
    if (this.held.size > 0 && this.startAt < now) {
      this.setRepeat(true);
      this.step(false);
    }
  }

  /** マップを受け取った時(Philly の MapRecv) */
  onMap() {
    if (this.pending > 0) this.pending--;
    if (this.repeat && this.pending === 0) this.step(false);
  }

  /** 「進めません.」を受けた時(Philly の CannotGo) */
  onCannotGo() {
    if (this.pending > 0) this.pending--;
    if (this.repeat && this.pending === 0) this.step(true);
  }

  private setRepeat(v: boolean) {
    if (this.repeat === v) return;
    this.repeat = v;
    this.send(`#map-iv ${v ? MAP_IV_REPEAT : MAP_IV_NORMAL}`);
    if (v) this.endAt = Infinity;
    else {
      this.startAt = Infinity;
      this.pending = 0;
    }
  }

  /** 押しているキーで1歩進む。onlyIfChanged なら前回と違う方向の時だけ */
  private step(onlyIfChanged: boolean) {
    const key = this.pick();
    if (!key) return;
    const changed = key !== this.last;
    this.last = key;
    if (onlyIfChanged && !changed) return;
    this.sendMove(key, false);
  }

  /** 押しているキーから送る方向を1つ選ぶ(Philly の GetMoveKeyState) */
  private pick(): MoveKey | null {
    const h = new Set([...this.held, ...this.mouse]);
    if (h.size === 0) return null;
    // 回転のキーは優先する
    for (const k of ["7", "9", "5"] as const) if (h.has(k)) return k;
    // 反対向きを同時に押していたら、前回と違う方を残す
    for (const [a, b] of OPPOSITE) {
      if (h.has(a) && h.has(b)) h.delete(this.last === a ? a : b);
    }
    const keys = [...h];
    if (keys.length === 1) return keys[0];
    // 斜めは2方向を交互に送る
    const diag = DIAGONAL.find(([a, b]) => h.has(a) && h.has(b));
    if (diag) return this.last === diag[1] ? diag[0] : diag[1];
    return keys[0];
  }

  private sendMove(key: MoveKey, always: boolean) {
    const cmd = moveCommand(key, this.mods, this.northFix());
    // リピート中は進む移動だけを繰り返す(Philly は GetMoveCommand が 1 の時だけ送る)
    if (!always && !cmd.go) return;
    this.send(cmd.text);
    this.pending++;
  }
}
