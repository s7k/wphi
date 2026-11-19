import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_UNCONFIRMED, WALK_DIAGONAL_MS, WALK_MS, Walker } from "./walker.ts";
import { Predictor } from "./predict.ts";
import type { MapEvent } from "./protocol";

function setup() {
  let t = 0;
  const w = new Walker<string>(() => t);
  return { w, advance: (ms: number) => (t += ms) };
}

test("押している間は、1歩を滑りきるまで次の1歩を返さない", () => {
  const { w, advance } = setup();
  w.keyDown("ArrowUp", "up", "none");
  assert.deepEqual(w.next(true), { keys: ["8"], mods: "none", ms: WALK_MS, at: 0 });
  advance(50);
  assert.equal(w.next(true), null);
  advance(50);
  assert.deepEqual(w.next(true)?.keys, ["8"]);
  // 離したら止まる
  w.keyUp("ArrowUp");
  advance(100);
  assert.equal(w.next(true), null);
});

test("2つの向きを押すと斜めに歩き、2行分の時間で滑らせる。逆向きは打ち消す", () => {
  const { w, advance } = setup();
  w.keyDown("ArrowUp", "up", "none");
  w.keyDown("ArrowRight", "right", "none");
  assert.deepEqual(w.next(true), { keys: ["8", "6"], mods: "none", ms: WALK_DIAGONAL_MS, at: 0 });
  advance(WALK_DIAGONAL_MS);
  w.keyDown("ArrowLeft", "left", "none");
  assert.deepEqual(w.next(true)?.keys, ["8"]);
});

test("返事を待つ移動が多い間は歩かない。押したままなら、keydown が届かなくなっても歩き続け、clear() で止まる", () => {
  const { w, advance } = setup();
  w.keyDown("ArrowDown", "down", "ctrl");
  assert.equal(w.next(false), null);
  assert.deepEqual(w.next(true)?.mods, "ctrl");
  // 下を押したまま右を押して離すと、OS のリピートは下に掛からなくなる。それでも下へ歩き続ける
  w.keyDown("ArrowRight", "right", "ctrl");
  w.keyUp("ArrowRight");
  advance(800);
  assert.deepEqual(w.next(true)?.keys, ["2"]);
  w.clear();
  advance(100);
  assert.equal(w.next(true), null);
});

test("キーを押していない間は、追尾移動の向きへ歩き、向きが届かなくなったら止まる", () => {
  const { w, advance } = setup();
  w.setFollow(["2", "4"], "none");
  assert.deepEqual(w.next(true)?.keys, ["2", "4"]);
  advance(WALK_DIAGONAL_MS + 200);
  assert.equal(w.next(true), null);
});

test("スムーズ移動の1歩は返事を待たずに進んだとみなし、鍵の掛かった所へは動かない1歩として順番を残す", () => {
  let t = 0;
  const p = new Predictor(() => t);
  // 5x5 の中央 (2,2) が自キャラ。北 (2,1) が鍵の掛かった箱
  const cells = Array.from({ length: 25 }, (_, i) => ({ chip: i === 7 ? "%".charCodeAt(0) : 32, attr: 0 }));
  const map = { type: "map", width: 5, height: 5, v6: true, dir: 0, style: "solid", cells, chars: [] } as MapEvent;
  p.onMoved(0, 0);
  p.onMap(null, map);
  p.walkStep("go E", WALK_MS);
  assert.deepEqual(p.offset, { dx: 1, dy: 0 });
  assert.equal(p.walk?.ms, WALK_MS);
  // 東へ1歩進んだ先から北は鍵の箱ではないので進む。元の位置の北(鍵の箱)へは進まない
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 1, dy: -1 });
  assert.equal(p.unconfirmed, 2);
  // 返事を待たずに進むのは MAX_UNCONFIRMED 行まで
  assert.ok(p.unconfirmed < MAX_UNCONFIRMED);
  // 返事は送った順に来る
  p.onMoved(1, 0);
  p.onMoved(0, -1);
  assert.equal(p.unconfirmed, 0);
  assert.deepEqual(p.offset, { dx: 1, dy: -1 });
  // 地図が来たら確かめた分を消す。今度は北が鍵の箱
  p.onMap(null, map);
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.equal(p.unconfirmed, 1);
  assert.equal(p.onMoved(0, 0), false);
  assert.equal(p.unconfirmed, 0);
  t += 1;
});

test("壁や木へ向かった1歩は進んだとみなさず、揺れの印を付ける。深い水か浅い水か分からない '_' へは進む", () => {
  let t = 0;
  const p = new Predictor(() => t);
  // 5x5 の中央 (2,2) が自キャラ。北が壁、東が木、南が水
  const chip = (i: number) => ({ 7: "#", 13: "T", 17: "_" } as Record<number, string>)[i] ?? " ";
  const cells = Array.from({ length: 25 }, (_, i) => ({ chip: chip(i).charCodeAt(0), attr: 0 }));
  const map = { type: "map", width: 5, height: 5, v6: true, dir: 0, style: "solid", cells, chars: [] } as MapEvent;
  p.onMoved(0, 0);
  p.onMap(null, map);
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.deepEqual(p.walk?.bump, { dx: 0, dy: -1, at: 0 });
  t = 10;
  p.walkStep("go E", WALK_MS);
  assert.deepEqual(p.walk?.bump, { dx: 1, dy: 0, at: 10 });
  p.walkStep("go S", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 1 });
  // 返事は3つとも送った順に合う
  assert.equal(p.unconfirmed, 3);
  p.onMoved(0, 0);
  p.onMoved(0, 0);
  p.onMoved(0, 1);
  assert.equal(p.unconfirmed, 0);
  assert.deepEqual(p.offset, { dx: 0, dy: 1 });
});

test("見た目が壁の隠し通路は、サーバが通したら覚え、同じ向きに続く壁も進む。行き止まりで元に戻す", () => {
  let t = 0;
  const p = new Predictor(() => t);
  // 5x5 の中央 (2,2) が自キャラ。北に壁が2マス続く
  const cells = Array.from({ length: 25 }, (_, i) => ({ chip: (i === 7 || i === 2 ? "#" : " ").charCodeAt(0), attr: 0 }));
  const map = { type: "map", width: 5, height: 5, v6: true, dir: 0, style: "solid", cells, chars: [] } as MapEvent;
  p.onMoved(0, 0);
  p.onMap(null, map);
  // 1歩目は壁とみなして揺らすが、サーバが通した
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.equal(p.onMoved(0, -1), true);
  assert.deepEqual(p.offset, { dx: 0, dy: -1 });
  // 2歩目は同じ向きの壁なので、隠し通路の中とみなして進む
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: -2 });
  // 行き止まりだった。元に戻し、隠し通路の中とみなすのもやめる
  p.onMoved(0, 0);
  assert.deepEqual(p.offset, { dx: 0, dy: -1 });
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: -1 });
  p.onMoved(0, 0);
  // 南へ戻ってから、もう一度北へ。1歩目に通った壁のマスは覚えているので、揺らさずに進む
  p.walkStep("go S", WALK_MS);
  p.onMoved(0, 1);
  p.onMap(null, map);
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: -1 });
  t += 1;
});

/** 5x5 の地図。rows は北から1行ずつ、中央 (2,2) が自キャラ */
function grid(rows: string[]): MapEvent {
  const cells = rows.join("").split("").map((c) => ({ chip: c.charCodeAt(0), attr: 0 }));
  return { type: "map", width: 5, height: 5, v6: true, dir: 0, style: "solid", cells, chars: [] } as MapEvent;
}

test("見えない所への1歩は進めも揺らしもせずに返事を待ち、後の1歩は本当の位置からなぞり直す", () => {
  let t = 0;
  const p = new Predictor(() => t);
  // 東 (3,2) は見えない所だが本当は床。その北 (3,1) は壁、元の位置の北 (2,1) は床
  p.onMoved(0, 0);
  p.onMap(null, grid([".....", "...#.", "...?.", ".....", "....."]));
  p.walkStep("go E", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.equal(p.walk?.bump, undefined);
  assert.equal(p.uncertain, true);
  // 返事を待つ間に送った北への1歩も、見えない所の先なので見せない
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  // サーバは見えない所を通した。北は壁なので、壁の中ではなくその手前に居る
  t = 50;
  assert.equal(p.onMoved(1, 0), true);
  assert.equal(p.uncertain, false);
  assert.deepEqual([p.walk?.x, p.walk?.y], [1, 0]);
  p.onMoved(0, 0);
  assert.deepEqual(p.offset, { dx: 1, dy: 0 });
});

test("進んだとみなした1歩をサーバが断ったら、後の1歩を本当の位置からなぞり直す", () => {
  let t = 0;
  const p = new Predictor(() => t);
  // 東 (3,2) は床(誰かが居て入れない)。その北 (3,1) は床、元の位置の北 (2,1) は壁
  p.onMoved(0, 0);
  p.onMap(null, grid([".....", "..#..", ".....", ".....", "....."]));
  p.walkStep("go E", WALK_MS);
  p.walkStep("go N", WALK_MS);
  assert.deepEqual(p.offset, { dx: 1, dy: -1 });
  // 東は断られた。北は元の位置の北(壁)へ向かう事になるので、元の位置に留まる
  assert.equal(p.onMoved(0, 0), true);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.equal(p.walk?.ms, 80);
  assert.equal(p.onMoved(0, 0), false);
});

test("見えない所への1歩を断られたら、その時に揺らす", () => {
  let t = 0;
  const p = new Predictor(() => t);
  p.onMoved(0, 0);
  p.onMap(null, grid([".....", ".....", "...?.", ".....", "....."]));
  p.walkStep("go E", WALK_MS);
  t = 70;
  p.onMoved(0, 0);
  assert.deepEqual(p.walk?.bump, { dx: 1, dy: 0, at: 70 });
  assert.equal(p.uncertain, false);
});

test("斜めのうち片方だけが壁なら、もう片方だけを縦横の1歩の時間で送る", () => {
  let t = 0;
  const p = new Predictor(() => t);
  // 北 (2,1) が壁、東は床
  p.onMoved(0, 0);
  p.onMap(null, grid([".....", "..#..", ".....", ".....", "....."]));
  assert.deepEqual(p.pick(["go N", "go E"]), ["go E"]);
  // 両方とも通れるか、両方とも壁ならそのまま
  assert.deepEqual(p.pick(["go S", "go E"]), ["go S", "go E"]);
  p.onMap(null, grid([".....", "..#..", "...T.", ".....", "....."]));
  assert.deepEqual(p.pick(["go N", "go E"]), ["go N", "go E"]);
  const w = new Walker<string>(() => t);
  w.keyDown("ArrowUp", "up", "none");
  w.keyDown("ArrowRight", "right", "none");
  assert.deepEqual(w.next(true, () => ["6"]), { keys: ["6"], mods: "none", ms: WALK_MS, at: 0 });
});

test("通れる見た目でサーバが断ったマス(透明な壁)は覚えて揺らし、サーバが通したら忘れる", () => {
  let t = 0;
  const p = new Predictor(() => t);
  p.onMoved(0, 0);
  p.onMap(null, grid([".....", ".....", ".....", ".....", "....."]));
  // 1度目は進んだとみなし、断られて戻る
  p.walkStep("go W", WALK_MS);
  assert.deepEqual(p.offset, { dx: -1, dy: 0 });
  p.onMoved(0, 0);
  // 2度目からは進まずに揺らす
  t = 100;
  p.walkStep("go W", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.deepEqual(p.walk?.bump, { dx: -1, dy: 0, at: 100 });
  // 斜めは壁に沿って滑らせる
  assert.deepEqual(p.pick(["go N", "go W"]), ["go N"]);
  // サーバが通した(居た物が退いた)ら忘れる
  assert.equal(p.onMoved(-1, 0), true);
  t = 200;
  p.walkStep("go E", WALK_MS);
  p.onMoved(1, 0);
  p.walkStep("go W", WALK_MS);
  assert.deepEqual(p.offset, { dx: -1, dy: 0 });
});

test("他のキャラやオブジェの居るマスへの1歩は、揺らさずに返事を待つ", () => {
  let t = 0;
  const p = new Predictor(() => t);
  const map = grid([".....", ".....", ".....", ".....", "....."]);
  const chair = { id: 1, x: 1, y: 2, dir: "F", name: "Chair", gra: "LANU_Rchair", status: 0, gigant: "#", layer: 12, default: 0x75 };
  p.onMoved(0, 0);
  p.onMap(null, { ...map, chars: [chair] });
  p.walkStep("go W", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.equal(p.uncertain, true);
  assert.equal(p.walk?.bump, undefined);
  t = 60;
  p.onMoved(0, 0);
  assert.deepEqual(p.walk?.bump, { dx: -1, dy: 0, at: 60 });
  // 断られたマスは覚えたので、次は待たずに揺らす
  p.walkStep("go W", WALK_MS);
  assert.equal(p.uncertain, false);
});

// ---- スムーズ移動の拍と予想 (#146) ----

/** 押す時間 T と、20ms ごとの見回りの始まり phase で歩かせ、出た1歩の予定の時刻を返す。t=0 に押して keyDown の直後に1歩 */
function holdFor(T: number, phase: number, room: () => number | boolean = () => true): number[] {
  let t = 0;
  const w = new Walker<string>(() => t);
  const ats: number[] = [];
  const poll = () => {
    const s = w.next(room());
    if (s) ats.push(s.at);
  };
  w.keyDown("ArrowRight", "right", "none");
  poll();
  for (let p = phase; p <= T + 1000; p += 20) {
    // 離すのと見回りが同じ時刻なら、離す方が先
    if (t < T && p >= T) {
      t = T;
      w.keyUp("ArrowRight");
    }
    t = p;
    poll();
  }
  return ats;
}

test("押した時間 T に対して、歩数は見回りのタイミングに依らず floor(T/100)+1 になる", () => {
  for (const T of [30, 80, 99, 101, 150, 199, 201, 299, 301, 1050, 3010]) {
    for (let phase = 0; phase < 20; phase++) {
      const ats = holdFor(T, phase);
      assert.equal(ats.length, Math.floor(T / WALK_MS) + 1, `T=${T} phase=${phase} ats=${ats}`);
    }
  }
});

test("押し続ける間は、1歩の始まりが 100ms ごとの予定の時刻に揃い、見回りの遅れを持ち越さない", () => {
  for (let phase = 0; phase < 20; phase++) {
    const ats = holdFor(3010, phase);
    ats.forEach((at, i) => assert.equal(at, i * WALK_MS, `phase=${phase} ats=${ats}`));
  }
});

test("離した後は今の1歩を滑りきって止まり、離した時刻が予定より前なら次の1歩を出さない", () => {
  let t = 0;
  const w = new Walker<string>(() => t);
  w.keyDown("ArrowUp", "up", "none");
  assert.equal(w.next(true)?.at, 0);
  t = 30;
  w.keyUp("ArrowUp");
  for (t = 40; t <= 400; t += 20) assert.equal(w.next(true), null);
});

test("止まってから押し直すと、古い予定の時刻ではなく押した時刻から数える", () => {
  let t = 0;
  const w = new Walker<string>(() => t);
  w.keyDown("ArrowUp", "up", "none");
  w.next(true);
  w.keyUp("ArrowUp");
  t = 1000;
  w.keyDown("ArrowUp", "up", "none");
  assert.equal(w.next(true)?.at, 1000);
  t = 1100;
  assert.equal(w.next(true)?.at, 1100);
});

test("返事待ちで遅れすぎたら拍を取り直し、送れる行数が足りなければ斜めは待つ", () => {
  let t = 0;
  const w = new Walker<string>(() => t);
  w.keyDown("ArrowUp", "up", "none");
  w.next(true);
  // 100ms の予定から 60ms 待たされた。予定の時刻のまま滑らせると一瞬で着くので、今から数える
  t = 160;
  assert.equal(w.next(true)?.at, 160);
  w.keyDown("ArrowRight", "right", "none");
  t = 260;
  // 斜めは 2 行要る
  assert.equal(w.next(1), null);
  assert.deepEqual(w.next(2)?.keys, ["8", "6"]);
});

/**
 * サーバの模型: 0.1 秒のティックに 1 行ずつ go を処理し、片道 owd ms で #v6 G を返す。
 * App と同じく、返事の来ていない行が MAX_UNCONFIRMED 未満の時だけ歩く。歩いた予定の時刻の間隔を返す
 */
function walkWithServer(owd: number, phase: number): number[] {
  let t = 0;
  const w = new Walker<string>(() => t);
  let sent: number[] = []; // 届く時刻
  let unconfirmed = 0;
  const replies: number[] = [];
  const ats: number[] = [];
  let lastTick = -Infinity;
  w.keyDown("ArrowRight", "right", "none");
  for (let ms = 0; ms <= 3000; ms++) {
    t = ms;
    // サーバのティック (時刻 0, 100, 200… に起き、届いた行を 1 つ処理する)
    if (ms % 100 === 0 && sent.length && sent[0] <= ms && ms > lastTick) {
      sent.shift();
      lastTick = ms;
      replies.push(ms + owd);
    }
    while (replies.length && replies[0] <= ms) {
      replies.shift();
      unconfirmed--;
    }
    if (ms === 0 || (ms - phase) % 20 === 0) {
      const s = w.next(Math.max(0, MAX_UNCONFIRMED - unconfirmed));
      if (s) {
        ats.push(s.at);
        unconfirmed += s.keys.length;
        sent.push(ms + owd);
      }
    }
  }
  return ats.slice(1).map((a, i) => a - ats[i]);
}

test("往復 100ms までは、返事を待って歩みが止まらない (1歩の間隔が全部 100ms)", () => {
  for (const owd of [10, 30, 50]) {
    for (let phase = 1; phase < 20; phase += 3) {
      const gaps = walkWithServer(owd, phase);
      assert.ok(gaps.length >= 25, `owd=${owd}`);
      assert.ok(gaps.every((g) => g === WALK_MS), `owd=${owd} phase=${phase} gaps=${gaps}`);
    }
  }
});

test("#v6 G 0 0 の理由が一時的な物 (chr obj bind palsy busy) なら、断られたマスを覚えない", () => {
  for (const reason of ["chr", "obj", "bind", "palsy", "busy"]) {
    let t = 0;
    const p = new Predictor(() => t);
    p.onMoved(0, 0);
    p.onMap(null, grid([".....", ".....", ".....", ".....", "....."]));
    p.walkStep("go W", WALK_MS);
    p.onMoved(0, 0, reason);
    t = 100;
    p.walkStep("go W", WALK_MS);
    assert.deepEqual(p.offset, { dx: -1, dy: 0 }, reason);
  }
  // wall は覚え、次はその場で揺らす
  let t = 0;
  const p = new Predictor(() => t);
  p.onMoved(0, 0);
  p.onMap(null, grid([".....", ".....", ".....", ".....", "....."]));
  p.walkStep("go W", WALK_MS);
  p.onMoved(0, 0, "wall");
  t = 100;
  p.walkStep("go W", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.deepEqual(p.walk?.bump, { dx: -1, dy: 0, at: 100 });
});

test("busy の返事では揺らさない", () => {
  let t = 0;
  const p = new Predictor(() => t);
  p.onMoved(0, 0);
  // 東は見えない所。返事を待つ
  p.onMap(null, grid([".....", ".....", "...?.", ".....", "....."]));
  p.walkStep("go E", WALK_MS);
  t = 50;
  p.onMoved(0, 0, "busy");
  assert.equal(p.walk?.bump, undefined);
});

test("オブジェを押して進んだ (push) 時は、押した後の地図が来るまで位置を進めない", () => {
  let t = 0;
  const p = new Predictor(() => t);
  p.onMoved(0, 0);
  // 東 (3,2) にオブジェ。居るマスは返事を待つ
  const m0 = { ...grid([".....", ".....", ".....", ".....", "....."]), chars: [{ id: 1, x: 3, y: 2 }] } as MapEvent;
  p.onMap(null, m0);
  p.walkStep("go E", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  t = 80;
  p.onMoved(1, 0, "push");
  // 押す前の古い地図をずらすと、オブジェが自分のマスに重なって見えたので、ずらさない
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.equal(p.walk?.x, 0);
  // 押した後の地図で、1 マス進んだ位置になる
  t = 100;
  p.onMap(null, grid([".....", ".....", ".....", ".....", "....."]));
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.equal(p.walk?.x, 1);
  assert.equal(p.walk?.at, 100);
});

test("押した後の地図が来なければ、待ちきった所で進める", () => {
  let t = 0;
  const p = new Predictor(() => t);
  p.onMoved(0, 0);
  p.onMap(null, { ...grid([".....", ".....", ".....", ".....", "....."]), chars: [{ id: 1, x: 3, y: 2 }] } as MapEvent);
  p.walkStep("go E", WALK_MS);
  p.onMoved(1, 0, "push");
  t = 400;
  assert.equal(p.tick(), false);
  assert.equal(p.walk?.x, 0);
  t = 600;
  assert.equal(p.tick(), true);
  assert.equal(p.walk?.x, 1);
});

test("サーバが通れないと印を付けたマス (#v6 X) へは、見た目が道でも進まずに揺らす", () => {
  let t = 0;
  const p = new Predictor(() => t);
  p.onMoved(0, 0);
  const m = grid([".....", ".....", ".....", ".....", "....."]);
  m.cells[13] = { ...m.cells[13], blocked: true };
  p.onMap(null, m);
  p.walkStep("go E", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.deepEqual(p.walk?.bump, { dx: 1, dy: 0, at: 0 });
  // 印の無い向きへは進む
  t = 100;
  p.walkStep("go W", WALK_MS);
  assert.deepEqual(p.offset, { dx: -1, dy: 0 });
});

test("盲目の間は '/' のマスを道とせず、返事を待つ", () => {
  let t = 0;
  const p = new Predictor(() => t);
  p.onMoved(0, 0);
  p.onMap(null, grid(["/////", "/////", "//.//", "/////", "/////"]));
  p.setBlind(true);
  p.walkStep("go E", WALK_MS);
  assert.deepEqual(p.offset, { dx: 0, dy: 0 });
  assert.equal(p.uncertain, true);
  p.onMoved(1, 0);
  p.setBlind(false);
  t = 100;
  p.walkStep("go E", WALK_MS);
  assert.deepEqual(p.offset, { dx: 2, dy: 0 });
});

test("#v6 J (go 以外で動いた) を受けたら、覚えた通れないマスを捨て、滑らせない印に epoch を変える", () => {
  let t = 0;
  const p = new Predictor(() => t);
  p.onMoved(0, 0);
  p.onMap(null, grid([".....", ".....", ".....", ".....", "....."]));
  p.walkStep("go W", WALK_MS);
  p.onMoved(0, 0, "wall");
  const epoch = p.walk?.epoch;
  p.onJumped();
  assert.notEqual(p.walk?.epoch, epoch);
  t = 100;
  p.walkStep("go W", WALK_MS);
  assert.deepEqual(p.offset, { dx: -1, dy: 0 });
});

test("スムーズ移動の1歩は、歩き方の予定の時刻から滑らせる", () => {
  let t = 120;
  const p = new Predictor(() => t);
  p.onMoved(0, 0);
  p.onMap(null, grid([".....", ".....", ".....", ".....", "....."]));
  p.walkStep("go E", WALK_MS, 100);
  assert.equal(p.walk?.at, 100);
  t = 260;
  p.walkStep("go E", WALK_MS);
  assert.equal(p.walk?.at, 260);
});
