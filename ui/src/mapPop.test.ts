import assert from "node:assert/strict";
import { test } from "node:test";
import { findChar, popsFromLine } from "./mapPop.ts";

const DM = "/*color=gray*/DM";

test("攻撃と回復の増減", () => {
  // dm_msg_jp.h の DMM_ATTACK_HP・DMM_CURE_SELF・DMM_CURE_OTHER・DMM_ABS_FROM_ATTACK・DMM_TRAP_HP
  assert.deepEqual(
    popsFromLine(`${DM} > 太郎 は 案内人 を /*.*/ロングソード /*color=gray*/で攻撃した. [/*color=-hp*/88/*color=gray*/ hp] `),
    [{ name: "案内人", kind: "-hp", text: "88" }],
  );
  assert.deepEqual(popsFromLine(`${DM} > 太郎 が /*.*/キュアー /*color=gray*/によって回復した. [/*color=+hp*/14/*color=gray*/ hp] `), [
    { name: "太郎", kind: "+hp", text: "14" },
  ]);
  assert.deepEqual(popsFromLine(`${DM} > 太郎 は 花子 を /*.*/キュアー/*color=gray*/ で回復した. [/*color=+mp*/9/*color=gray*/ mp] `), [
    { name: "花子", kind: "+mp", text: "9" },
  ]);
  assert.deepEqual(
    popsFromLine(`${DM} > 案内人 は 太郎 の /*.*/ファイア /*color=gray*/による攻撃を吸収した. [/*color=+hp*/30/*color=gray*/ hp]`),
    [{ name: "案内人", kind: "+hp", text: "30" }],
  );
  assert.deepEqual(popsFromLine(`${DM} > 太郎 は 毒の沼 からダメージを受けた. [/*color=-hp*/5/*color=gray*/ hp] `), [
    { name: "太郎", kind: "-hp", text: "5" },
  ]);
  assert.deepEqual(popsFromLine(`${DM} > 太郎 は食中毒でダメージを受けた. [/*color=-mp*/3/*color=gray*/ mp] `), [
    { name: "太郎", kind: "-mp", text: "3" },
  ]);
  // dm_msg_en.h
  assert.deepEqual(popsFromLine(`${DM} > Taro attacked to Guide by Long sword. [/*color=-hp*/88/*.*/ hp] `), [
    { name: "Guide", kind: "-hp", text: "88" },
  ]);
  assert.deepEqual(popsFromLine(`${DM} > Taro is cured by Cure. [/*color=+hp*/14/*.*/ hp] `), [{ name: "Taro", kind: "+hp", text: "14" }]);
});

test("増減ではない色付きの数字は出さない", () => {
  assert.deepEqual(popsFromLine(`${DM} > 太郎 は Fighter level が /*color=+mp*/1/*color=gray*/ 上昇した.`), []);
  assert.deepEqual(popsFromLine(`${DM} > /*color=-hp*/12/*color=gray*//100 hp left. `), []);
  assert.deepEqual(popsFromLine(`${DM} > 進めません.`), []);
});

test("発言の吹き出し", () => {
  assert.deepEqual(popsFromLine("花子 > こんにちは"), [{ name: "花子", kind: "talk", text: "こんにちは" }]);
  assert.deepEqual(popsFromLine("[花子] > /*color=red*/内緒/*.*/"), [{ name: "花子", kind: "talk", text: "内緒" }]);
  assert.deepEqual(popsFromLine("はじまりの草原に着いた。"), []);
});

test("同じ名前なら中央に近いキャラ", () => {
  const chars = [
    { x: 0, y: 0, name: "スライム" },
    { x: 4, y: 3, name: "/*color=red*/スライム" },
    { x: 3, y: 3, name: "太郎" },
  ];
  assert.equal(findChar(chars, "スライム", 3), chars[1]);
  assert.equal(findChar(chars, "花子", 3), undefined);
});
