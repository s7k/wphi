// 他のキャラを、前の地図の位置から滑らかに動かす (#195)。キャラは #v6 O の個体の番号で突き合わせ、
// 世界の座標 (地図の座標から自キャラのマスを引き、自キャラの世界の座標を足した物) で前の地図と比べる

/** 滑らせる時間 (ms)。地図は 0.1〜0.2 秒ごとに届く */
export const GLIDE_MS = 200;

type Pos = { x: number; y: number };

/**
 * 今の地図の各キャラの世界の座標と、前の地図から 1 マス (斜めを含む) 動いたキャラの動いた量を返す。
 * 2 マスより大きく動いたキャラ (ゲートなど) は滑らせない。動いたキャラが 2 人以上いて、その過半数が同じ量なら、
 * 自キャラの世界の座標のずれ (予想と地図の食い違い) とみなして、どれも滑らせない
 */
export function glideMoves(
  prev: Map<number, Pos>,
  chars: { id: number; x: number; y: number }[],
  self: Pos,
  selfWorld: Pos,
): { world: Map<number, Pos>; moved: Map<number, Pos> } {
  const world = new Map<number, Pos>();
  const moved = new Map<number, Pos>();
  for (const c of chars) {
    if (c.x === self.x && c.y === self.y) continue;
    const w = { x: c.x - self.x + selfWorld.x, y: c.y - self.y + selfWorld.y };
    world.set(c.id, w);
    const p = prev.get(c.id);
    if (!p) continue;
    const d = { x: w.x - p.x, y: w.y - p.y };
    if ((d.x || d.y) && Math.abs(d.x) <= 1 && Math.abs(d.y) <= 1) moved.set(c.id, d);
  }
  const seen = [...prev.keys()].filter((id) => world.has(id)).length;
  const counts = new Map<string, number>();
  for (const d of moved.values()) counts.set(`${d.x},${d.y}`, (counts.get(`${d.x},${d.y}`) ?? 0) + 1);
  if (seen >= 2 && [...counts.values()].some((n) => n * 2 > seen)) moved.clear();
  return { world, moved };
}
