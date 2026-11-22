// サーバから切れた時の動き (#178 #179)。死んで切れたら繋ぎ直すか聞き、それ以外で切れたら間を空けて自動で繋ぎ直す

/** 自動で繋ぎ直すまでの間 (ms)。この回数だけ試して、繋がらなければやめる */
export const RETRY_DELAYS = [2000, 5000, 15000];

/** 死の知らせ (DMM_DEAD)。タグを除いた行で見る。発言の中の同じ言葉に当たらない様に DM の行に限る */
export const DEAD_LINE = /^DM > (あなたは死にました|You are dead)/;
/** 二重ログインで別のクライアントへ操作権を移した知らせ (DMM_CHANGE_CLIENT_OUT)。この時は繋ぎ直さない */
export const KICKED_LINE = /^DM > (操作権を移動し、このクライアントを閉じます|Now passing character and closing this client)/;

export type AfterClose = { kind: "none" } | { kind: "ask-dead" } | { kind: "retry"; delay: number; nth: number };

/**
 * 切れた後にする事。mine は自分で切った時、tries はこのキャラで続けて自動で繋ぎ直した回数
 */
export function afterClose(c: { mine: boolean; died: boolean; kicked: boolean }, tries: number): AfterClose {
  if (c.mine || c.kicked) return { kind: "none" };
  if (c.died) return { kind: "ask-dead" };
  const delay = RETRY_DELAYS[tries];
  return delay === undefined ? { kind: "none" } : { kind: "retry", delay, nth: tries + 1 };
}

/** 死ぬ前と繋ぎ直した後の最大 HP・MP の差の知らせ。下がっていなければ null */
export function lossText(before: { maxHp?: number; maxMp?: number }, after: { maxHp?: number; maxMp?: number }): string | null {
  const part = (name: string, a?: number, b?: number) => (a !== undefined && b !== undefined && b < a ? `${name} ${a} → ${b}` : "");
  const parts = [part("最大 HP", before.maxHp, after.maxHp), part("最大 MP", before.maxMp, after.maxMp)].filter(Boolean);
  return parts.length ? `死んだので ${parts.join("、")} に下がりました。` : null;
}
