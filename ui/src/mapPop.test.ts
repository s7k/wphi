import assert from "node:assert/strict";
import { test } from "node:test";
import { findChar, newPopState, popsFromLine } from "./mapPop.ts";

const DM = "/*color=gray*/DM";

test("攻撃と回復の増減", () => {
  // dm_msg_jp.h の DMM_ATTACK_HP・DMM_CURE_SELF・DMM_CURE_OTHER・DMM_ABS_FROM_ATTACK・DMM_TRAP_HP
  assert.deepEqual(
    popsFromLine(`${DM} > 太郎 は 案内人 を /*.*/ロングソード /*color=gray*/で攻撃した. [/*color=-hp*/88/*color=gray*/ hp] `),
    [{ name: "案内人", kind: "-hp", text: "88", by: "太郎" }],
  );
  assert.deepEqual(popsFromLine(`${DM} > 太郎 が /*.*/キュアー /*color=gray*/によって回復した. [/*color=+hp*/14/*color=gray*/ hp] `), [
    { name: "太郎", kind: "+hp", text: "14" },
  ]);
  assert.deepEqual(popsFromLine(`${DM} > 太郎 は 花子 を /*.*/キュアー/*color=gray*/ で回復した. [/*color=+mp*/9/*color=gray*/ mp] `), [
    { name: "花子", kind: "+mp", text: "9" },
  ]);
  assert.deepEqual(
    popsFromLine(`${DM} > 案内人 は 太郎 の /*.*/ファイア /*color=gray*/による攻撃を吸収した. [/*color=+hp*/30/*color=gray*/ hp]`),
    [{ name: "案内人", kind: "+hp", text: "30", by: "太郎" }],
  );
  assert.deepEqual(popsFromLine(`${DM} > 太郎 は 毒の沼 からダメージを受けた. [/*color=-hp*/5/*color=gray*/ hp] `), [
    { name: "太郎", kind: "-hp", text: "5" },
  ]);
  assert.deepEqual(popsFromLine(`${DM} > 太郎 は食中毒でダメージを受けた. [/*color=-mp*/3/*color=gray*/ mp] `), [
    { name: "太郎", kind: "-mp", text: "3" },
  ]);
  // 色のタグを付けないサーバ
  assert.deepEqual(popsFromLine("DM > Wilt が Goddess hand! によって回復した. [4256 hp]"), [{ name: "Wilt", kind: "+hp", text: "4256" }]);
  assert.deepEqual(popsFromLine("DM > Wilt は スライム を 剣 で攻撃した. [30 hp]"), [{ name: "スライム", kind: "-hp", text: "30", by: "Wilt" }]);
  // dm_msg_en.h
  assert.deepEqual(popsFromLine(`${DM} > Taro attacked to Guide by Long sword. [/*color=-hp*/88/*.*/ hp] `), [
    { name: "Guide", kind: "-hp", text: "88", by: "Taro" },
  ]);
  assert.deepEqual(popsFromLine(`${DM} > Taro is cured by Cure. [/*color=+hp*/14/*.*/ hp] `), [{ name: "Taro", kind: "+hp", text: "14" }]);
});

test("唱えた呪文で攻撃したら魔法", () => {
  const spoken = newPopState();
  popsFromLine("Wilt > Fire ball", spoken);
  assert.deepEqual(popsFromLine("DM > Wilt は スライム を Fire ball で攻撃した. [30 hp]", spoken), [
    { name: "スライム", kind: "-hp", text: "30", by: "Wilt", magic: true },
  ]);
  // 唱えた後でも、武器で攻撃したら斬撃
  assert.deepEqual(popsFromLine("DM > Wilt は スライム を ロングソード で攻撃した. [12 hp]", spoken), [
    { name: "スライム", kind: "-hp", text: "12", by: "Wilt" },
  ]);
  assert.deepEqual(popsFromLine("DM > Wilt attacked Slime by Fire ball. [30 hp]", spoken), [
    { name: "Slime", kind: "-hp", text: "30", by: "Wilt", magic: true },
  ]);
});

test("ミス・倒された・毒と麻痺", () => {
  // dm_msg_jp.h・dm_msg_en.h の DMM_MISS_ATTACK・DMM_KILL_*・DMM_POISON*・DMM_PALSY*
  const one = (line: string) => popsFromLine(`${DM} > ${line} `);
  assert.deepEqual(one("太郎 はミスした."), [{ name: "太郎", kind: "miss", text: "MISS" }]);
  assert.deepEqual(one("Taro miss."), [{ name: "Taro", kind: "miss", text: "MISS" }]);
  assert.deepEqual(one("スライム は 太郎 に殺された."), [{ name: "スライム", kind: "dead", text: "" }]);
  assert.deepEqual(one("太郎 は スライム に/*color=red*/殺された/*.*/."), [{ name: "太郎", kind: "dead", text: "" }]);
  assert.deepEqual(one("太郎 は 毒で死んだ."), [{ name: "太郎", kind: "dead", text: "" }]);
  assert.deepEqual(one("Slime is killed by Taro."), [{ name: "Slime", kind: "dead", text: "" }]);
  assert.deepEqual(one("太郎 は 3 lv の毒を受けた."), [{ name: "太郎", kind: "poison", text: "毒" }]);
  assert.deepEqual(one("太郎 は 3 lv の毒を /*.*/Poison /*color=gray*/によって受けた."), [{ name: "太郎", kind: "poison", text: "毒" }]);
  assert.deepEqual(one("Taro is 3 lv poisoned."), [{ name: "Taro", kind: "poison", text: "毒" }]);
  assert.deepEqual(one("太郎 は 5 秒間 麻痺する."), [{ name: "太郎", kind: "palsy", text: "麻痺" }]);
  assert.deepEqual(one("太郎 は 5 秒間 /*.*/Palsy /*color=gray*/によって麻痺した."), [{ name: "太郎", kind: "palsy", text: "麻痺" }]);
  assert.deepEqual(one("Taro is paralyzed in 5 sec."), [{ name: "Taro", kind: "palsy", text: "麻痺" }]);
  // 既に麻痺している、は出さない
  assert.deepEqual(one("太郎 は既に麻痺している."), []);
});

test("強化と弱体", () => {
  const st = newPopState();
  const one = (line: string) => popsFromLine(`${DM} > ${line} `, st);
  // 自分にかけた強化は、名前が無いので "" にし、地図が中央の自分に出す
  assert.deepEqual(one("攻撃力が 12 point 上がった."), [{ name: "", kind: "buff", text: "攻撃力↑" }]);
  assert.deepEqual(one("防御率が 20% 60 秒間上がった."), [{ name: "", kind: "buff", text: "防御率↑" }]);
  assert.deepEqual(one("Attack speed is 10% up in 60 sec."), [{ name: "", kind: "buff", text: "攻撃速度↑" }]);
  assert.deepEqual(one("/*.*/Force field /*color=gray*/が 30 秒間張られる."), [{ name: "", kind: "buff", text: "Force field" }]);
  // 仲間にかけた時は、直前の「かけた」の相手に出す。その次の行からは自分に戻る
  assert.deepEqual(one("太郎 は 花子 に /*.*/Protect /*color=gray*/をかけた."), []);
  assert.deepEqual(one("防御率が 20% 上がった."), [{ name: "花子", kind: "buff", text: "防御率↑" }]);
  assert.deepEqual(one("魔法抵抗率が 20% 上がった."), [{ name: "", kind: "buff", text: "魔法抵抗率↑" }]);
  assert.deepEqual(one("スライム の攻撃力が 5 point /*.*/Degrade /*color=gray*/によって下がった."), [
    { name: "スライム", kind: "debuff", text: "攻撃力↓" },
  ]);
  assert.deepEqual(one("スライム の速度が 30% 60 秒間 /*.*/Slow /*color=gray*/によって下がった."), [
    { name: "スライム", kind: "debuff", text: "速度↓" },
  ]);
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
  assert.equal(findChar(chars, "", 3), chars[2]);
});
