// マップのキャラの上に出す、発言の吹き出しと HP・MP の増減(Philly に無い)。
// main 窓がログの行から作って MAP_POP_EVENT で地図へ送り、地図が名前でキャラを探して上に出す。
//
// 増減はサーバの戦闘メッセージ(dm_msg_jp.h・dm_msg_en.h)の "[/*color=-hp*/88/*color=gray*/ hp]" から取る。
// 数字の付く色のタグは他にもある(レベルの上下、DMM_LEFT_HP など)が、"[" と " hp]" で挟んだ形は増減だけ。
// 色のタグの付かないサーバもある("[4256 hp]")ので、増えたか減ったかは動詞で決める

export const MAP_POP_EVENT = "phi-map-pop";

export type PopKind = "talk" | "-hp" | "+hp" | "-mp" | "+mp";
/** by は攻撃したキャラ。地図が斬撃を出し、magic なら魔法弾を出す */
export type Pop = { name: string; kind: PopKind; text: string; by?: string; magic?: true };

export const stripTags = (s: string) => s.replace(/\/\*.*?\*\//g, "").trim();

const AMOUNT = /\[(\d+) ([hm])p\]/;
const GAIN = /回復した|吸収した|absorbed|cured/;

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
export function popsFromLine(raw: string, spoken = new Map<string, string>()): Pop[] {
  const text = stripTags(raw);
  const sep = text.indexOf(" > ");
  if (sep <= 0) return [];
  const who = text.slice(0, sep).trim();
  const body = text.slice(sep + 3).trim();
  if (who === "DM") {
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

/** name のキャラのうち、中央(自分)に一番近い物。同じ名前のキャラが複数いる時に、どれか分からない為 */
export function findChar<C extends { x: number; y: number; name: string }>(chars: C[], name: string, center: number): C | undefined {
  let best: C | undefined;
  let bestD = Infinity;
  for (const c of chars) {
    if (stripTags(c.name) !== name) continue;
    const d = Math.abs(c.x - center) + Math.abs(c.y - center);
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}
