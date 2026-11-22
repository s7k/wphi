// マップのキャラの上に出す、発言の吹き出しと HP・MP の増減(Philly に無い)。
// main 窓がログの行から作って MAP_POP_EVENT で地図へ送り、地図が名前でキャラを探して上に出す。
//
// 増減はサーバの戦闘メッセージ(dm_msg_jp.h・dm_msg_en.h)の "[/*color=-hp*/88/*color=gray*/ hp]" から取る。
// 数字の付く色のタグは他にもある(レベルの上下、DMM_LEFT_HP など)が、"[" と " hp]" で挟んだ形は増減だけ。
// 色のタグの付かないサーバもある("[4256 hp]")ので、増えたか減ったかは動詞で決める

export const MAP_POP_EVENT = "phi-map-pop";

/** dead は倒されたキャラ。倒されたキャラは地図から消えるので、地図は届いた時の位置に出す */
export type PopKind = "talk" | "-hp" | "+hp" | "-mp" | "+mp" | "miss" | "poison" | "palsy" | "dead" | "buff" | "debuff";
/** by は攻撃したキャラ。地図が斬撃を出し、magic なら魔法弾を出す */
export type Pop = { name: string; kind: PopKind; text: string; by?: string; magic?: true };
/** #v6 E の演出。位置は視界の座標 (#v6 O と同じ)。from は攻撃した側で、視界の外なら無い */
export type Fx = { kind: string; from?: { x: number; y: number }; at: { x: number; y: number }; element?: string; category?: string; wait?: number };

export const stripTags = (s: string) => s.replace(/\/\*.*?\*\//g, "").trim();

const AMOUNT = /\[(\d+) ([hm])p\]/;
const GAIN = /回復した|吸収した|absorbed|cured/;

/**
 * タブごとに、前の行から引き継ぐ物。
 * spoken はキャラごとに最後に唱えた発言。
 * castTo は直前の「A は B に 呪文 をかけた.」の B。強化の行には名前が無く、唱えた人とかけられた人の両方に届く為
 */
export type PopState = { spoken: Map<string, string>; castTo?: string };
export const newPopState = (): PopState => ({ spoken: new Map() });

/**
 * 強化の行(DMM_COAT・DMM_PROTECT など)。名前が無いので、かけられたキャラ(castTo)に出す。
 * castTo が無ければ自分に出す。自分の名前は届かないサーバもあるので、name を "" にし、地図が中央のキャラに出す。
 * 1つ目の括弧が出す文字
 */
const BUFFS: RegExp[] = [
  /^(攻撃力|魔力|防御率|魔法抵抗率|攻撃速度|魔法回避率)が \d+(?: point|%) (?:\d+ 秒間)?上がった/,
  /^(Attack point|Spell point|Defence rate|Magic resistance rate|Attack speed|Magic rejection rate) is \d+%? up/,
  // DMM_FORCEFIELD など。呪文の名前を出す
  /^(.+?) が \d+ 秒間張られる/,
  /^(.+?) is appeared in \d+ sec/,
];
const BUFF_LABEL: Record<string, string> = {
  "Attack point": "攻撃力",
  "Spell point": "魔力",
  "Defence rate": "防御率",
  "Magic resistance rate": "魔法抵抗率",
  "Attack speed": "攻撃速度",
  "Magic rejection rate": "魔法回避率",
};
/** 弱体の行(DMM_DEGRADE など)。1つ目の括弧がキャラ、2つ目が下がった物 */
const DEBUFFS: RegExp[] = [/^(.+?) の(攻撃力|魔力|防御率|魔法抵抗率|速度|魔法回避率)が \d+(?: point|%) .*によって下がった/];

/** 増減の付かない知らせ。(文型, 種類, 出す文字)。どれも1つ目の括弧がキャラ */
const NOTICES: [RegExp, PopKind, string][] = [
  // DMM_MISS_ATTACK。攻撃した側しか分からないので、攻撃した側に出す
  [/^(.+?) ?はミスした\./, "miss", "MISS"],
  [/^(.+?) miss\./, "miss", "MISS"],
  // DMM_KILL_BY_OTHER・DMM_KILL_BY_PK・DMM_KILL_SELF
  [/^(.+?) は .+?に殺された\./, "dead", ""],
  [/^(.+?) は .+?で死んだ\./, "dead", ""],
  [/^(.+?) is killed by /, "dead", ""],
  // DMM_POISON_BY_ATTACK・DMM_POISON・DMM_PALSY_BY_ATTACK・DMM_PALSY
  [/^(.+?) は \d+ lv の毒を/, "poison", "毒"],
  [/^(.+?) is \d+ lv poisoned/, "poison", "毒"],
  [/^(.+?) は \d+ 秒間 .*麻痺/, "palsy", "麻痺"],
  [/^(.+?) is paralyzed in /, "palsy", "麻痺"],
];

/** 増減を受けたキャラ(to)と、攻撃したキャラ(by)とその武器か魔法(with)。文型で決める */
function target(s: string): { to: string; by?: string; with?: string } | undefined {
  let m: RegExpMatchArray | null;
  // "B は A の 武器 による攻撃を吸収した" "B は A の 魔法 を吸収した"
  if ((m = s.match(/^(.+?) は (.+?) の (.+?) (?:による攻撃を|を)吸収した/))) return { to: m[1], by: m[2], with: m[3] };
  if ((m = s.match(/^(.+?) absorbed from (.+?)'s /))) return { to: m[1], by: m[2] };
  // "A は B を 武器 で攻撃した"
  if ((m = s.match(/^(.+?) は (.+?) を (.+?) で攻撃した/) ?? s.match(/^(.+?) attacked(?: to)? (.+?) by (.+?)\. \[/)))
    return { to: m[2], by: m[1], with: m[3] };
  // "A は B を 魔法 で回復した"
  if ((m = s.match(/^.+? は (.+?) を /) ?? s.match(/^.+? cured (.+?) by /))) return { to: m[1] };
  // "A が 魔法 によって回復した" "B は 罠 からダメージを受けた"
  if ((m = s.match(/^(.+?) (?:は|が|is )/))) return { to: m[1] };
}

/**
 * ログの1行(タグ付き)から、地図に出す物を作る。
 * 武器と魔法の攻撃は同じ文型なので、唱えた発言("Wilt > Goddess hand!")を spoken に覚えておき、
 * 攻撃の行の武器の欄が、攻撃したキャラが最後に唱えた発言と同じなら魔法にする
 */
export function popsFromLine(raw: string, state = newPopState()): Pop[] {
  const { spoken } = state;
  const text = stripTags(raw);
  const sep = text.indexOf(" > ");
  if (sep <= 0) return [];
  const who = text.slice(0, sep).trim();
  const body = text.slice(sep + 3).trim();
  if (who === "DM") {
    const castTo = state.castTo;
    state.castTo = undefined;
    const cast = body.match(/^.+? は (.+?) に .+ をかけた\./);
    if (cast) {
      state.castTo = cast[1];
      return [];
    }
    for (const re of BUFFS) {
      const m = body.match(re);
      const name = castTo ?? "";
      if (m) return [{ name, kind: "buff", text: `${BUFF_LABEL[m[1]] ?? m[1]}${re === BUFFS[2] || re === BUFFS[3] ? "" : "↑"}` }];
    }
    for (const re of DEBUFFS) {
      const m = body.match(re);
      if (m) return [{ name: m[1], kind: "debuff", text: `${m[2]}↓` }];
    }
    for (const [re, kind, label] of NOTICES) {
      const m = body.match(re);
      if (m) return [{ name: m[1], kind, text: label }];
    }
    const a = body.match(AMOUNT);
    const t = a && target(body);
    const kind = a && (`${GAIN.test(body) ? "+" : "-"}${a[2]}p` as PopKind);
    if (!a || !t || !kind) return [];
    const magic = !!t.by && !!t.with && spoken.get(t.by) === t.with;
    return [{ name: t.to, kind, text: a[1], ...(t.by && { by: t.by }), ...(magic && { magic: true as const }) }];
  }
  // "名前 > 発言" と priv の "[名前] > 発言"。NPC の発言も同じ形
  const name = who.startsWith("[") && who.endsWith("]") ? who.slice(1, -1) : who;
  if (name) spoken.set(name, body);
  return name && body ? [{ name, kind: "talk", text: body }] : [];
}

/**
 * name のキャラのうち、自分(me のマス)に一番近い物。同じ名前のキャラが複数いる時に、どれか分からない為。
 * name が "" なら自分
 */
export function findChar<C extends { x: number; y: number; name: string }>(
  chars: C[],
  name: string,
  me: { x: number; y: number },
): C | undefined {
  if (!name) return chars.find((c) => c.x === me.x && c.y === me.y);
  let best: C | undefined;
  let bestD = Infinity;
  for (const c of chars) {
    if (stripTags(c.name) !== name) continue;
    const d = Math.abs(c.x - me.x) + Math.abs(c.y - me.y);
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}

/**
 * ログの行の種類 (ログの絞り込み。#181)。talk は発言 (priv と NPC を含む)、battle は戦闘の知らせ
 * (増減・ミス・死亡・状態異常・強化・弱体・呪文をかけた行)、other はそれ以外 (DM の案内、システムの行など)
 */
export function logKind(raw: string | undefined): "talk" | "battle" | "other" {
  if (!raw) return "other";
  const text = stripTags(raw);
  const sep = text.indexOf(" > ");
  if (sep <= 0) return "other";
  if (text.slice(0, sep).trim() !== "DM") return "talk";
  const body = text.slice(sep + 3).trim();
  if (/^.+? は .+? に .+ をかけた\./.test(body) || /^.+? は .+? を .+ (?:で|で攻撃した)/.test(body)) return "battle";
  return popsFromLine(raw).length ? "battle" : "other";
}
