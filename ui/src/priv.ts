// priv(Philly の CharacterCommon.cpp classPrivMessage と PrivForm.cpp)。
// 会話は相手の名前の組で分ける。送る時は本文の先頭に相手ごとの /*to=名前*/ を付け、
// 受けた側はそのタグで3人以上の会話を見分ける。

export type User = { name: string; no: number };

/** userList イベントの key は u<番号> */
export function usersFromEvent(users: { key: string; name: string }[]): User[] {
  return users.map((u) => ({ name: u.name, no: Number(u.key.slice(1)) }));
}

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/**
 * 受けた priv の会話の相手(送り主と、/*to=*\/ の宛先から自分を除いた名前を並べたもの)。
 * tag_to_html は /*to=名前*\/ を <!--to=名前--> にするので、HTML から読む。
 */
export function privPartners(from: string, html: string, self: string): string[] {
  const names = new Set<string>([from]);
  for (const m of html.matchAll(/<!--to=(.*?)-->/g)) names.add(decode(m[1]));
  names.delete(self);
  return [...names].sort();
}

export const partnersKey = (to: string[]) => [...to].sort().join("\n");

/** 会話の数の上限。宛先のタグを変えながら送られても、会話が増え続けないようにする(#53) */
export const MAX_CONVS = 50;

/** 上限を超えたら、表示中でない会話のうち一番古く作った物を捨てる(会話は作った順に並ぶ) */
export function capConvs<T extends { to: string[] }>(convs: T[], active: string | null, max = MAX_CONVS): T[] {
  if (convs.length <= max) return convs;
  const drop = convs.findIndex((c) => partnersKey(c.to) !== active);
  return convs.filter((_, i) => i !== drop);
}

/** 送る行。相手ごとに priv <番号> を付け、宛先のタグを前置する。番号の分からない相手は失敗として返す */
export function privLines(to: string[], text: string, users: User[], self: string): { lines: string[]; failed: string[] } {
  const no = (name: string) => users.find((u) => u.name === name)?.no;
  const tags = to.filter((n) => no(n) !== undefined).map((n) => `/*to=${n}*/`).join("");
  const body = tags + text;
  const failed = to.filter((n) => no(n) === undefined);
  const lines = to.flatMap((n) => (no(n) === undefined ? [] : [`priv ${no(n)} ${body}`]));
  // 1人にでも送れたら自分にも送る。自分宛ての分が会話の記録になる
  const selfNo = no(self);
  if (lines.length > 0 && selfNo !== undefined) lines.push(`priv ${selfNo} ${body}`);
  return { lines, failed };
}
