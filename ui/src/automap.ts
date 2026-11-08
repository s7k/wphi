// 拡張マップ(マッピング)。phi-client-web の stores/automapStore.ts から移植した。
//
// サーバが絶対座標(#ex-pos。v5y の :U ZA 拡張で、朱蓮だけが送る)を付けた時だけ、見えた地形を世界ごとに貯める。
// 7x7 北固定の行 r・列 c は絶対座標 (x+c-3, y-3+r)。視界外('?')は貯めない。
// 回転マップは向きで座標がずれるので扱わない。盲目中のフレームは呼び出し側が貯めない。
// 貯めた地形は localStorage(phi_automap:<世界名>)に置き、ログアウトしても消さない。
// main 窓が貯め、変わったマスを AUTOMAP_EVENT で map 窓へ送る。localStorage へは数秒ごとにまとめて書く。
// 歩くたびに全マスを JSON にして書くと、探索が進むほど重くなる為(#28)。
import type { MapCell, MapChar, MapEvent } from "./protocol";

const UNKNOWN = "?".charCodeAt(0);

/** "x,y" → セル */
export type Tiles = Record<string, MapCell>;

/** 通常マップ(7x7)の外側に足す記録地図の幅の上限(マス) */
export const AUTOMAP_RING = 4;

/**
 * マップの欄(幅 w・高さ h ピクセル)に出す外周の幅(マス)。
 * 外周の一番外のマスは、半分以上見えれば欄の端で切れても出す。収まる分だけにすると、既定の大きさの map 窓
 * (マップの欄が約 284px、外周1マスに要るのは 288px)で外周が出ない。中央の 7x7 は切らない
 */
export function ringFor(w: number, h: number, chip: number): number {
  const side = Math.min(w, h);
  if (side < 7 * chip) return 0;
  return Math.min(AUTOMAP_RING, Math.round((side / chip - 7) / 2));
}

/** 変わったマス。main 窓 → map 窓 */
export const AUTOMAP_EVENT = "phi-automap";
/** clear の時は、その世界の貯めた地形を全部消してから diff を足す */
export type AutomapDiff = { world: string; diff: Tiles; clear?: boolean };

/** v0.1.13 までの、世界全体を1つにした鍵。読んだら区画の鍵へ移す */
export const storageKey = (world: string) => `phi_automap:${world}`;

/** localStorage へは BLOCK x BLOCK マスの区画ごとに書き、変わった区画だけを書き直す(#74)。
 * 鍵は `phi_automap_blk:<区画>:<世界>`。区画を先に置くので、`:` を含む世界名でも取り違えない */
const BLOCK = 32;
const BLOCK_PREFIX = "phi_automap_blk:";
const blockKey = (world: string, block: string) => `${BLOCK_PREFIX}${block}:${world}`;

/** マスの鍵 "x,y" の区画 */
export function blockOf(tile: string): string {
  const [x, y] = tile.split(",").map(Number);
  return `${Math.floor(x / BLOCK)},${Math.floor(y / BLOCK)}`;
}

/** tiles のうち blocks の区画のマスを、区画ごとに分ける(区画にマスが無ければ空) */
export function groupByBlock(tiles: Tiles, blocks: Set<string>): Map<string, Tiles> {
  const out = new Map<string, Tiles>([...blocks].map((b) => [b, {}]));
  for (const [k, cell] of Object.entries(tiles)) {
    const g = out.get(blockOf(k));
    if (g) g[k] = cell;
  }
  return out;
}

function worldBlockKeys(world: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(BLOCK_PREFIX)) continue;
    const rest = k.slice(BLOCK_PREFIX.length);
    if (rest.slice(rest.indexOf(":") + 1) === world) keys.push(k);
  }
  return keys;
}

function parseTiles(s: string | null): Tiles {
  const v: unknown = s ? JSON.parse(s) : {};
  // 形の違う物が入っていたら、無かった事にする
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Tiles) : {};
}

export function loadTiles(world: string): Tiles {
  try {
    const tiles = parseTiles(localStorage.getItem(storageKey(world)));
    for (const k of worldBlockKeys(world)) Object.assign(tiles, parseTiles(localStorage.getItem(k)));
    return tiles;
  } catch {
    return {};
  }
}

export function removeTiles(world: string) {
  try {
    localStorage.removeItem(storageKey(world));
    for (const k of worldBlockKeys(world)) localStorage.removeItem(k);
  } catch {
    // 読めない時は貯めてもいない
  }
}

/** blocks の区画を書き直す。古い形の鍵が残っていれば、全部の区画に移して消す */
export function saveTiles(world: string, tiles: Tiles, blocks: Set<string>) {
  try {
    const old = localStorage.getItem(storageKey(world)) !== null;
    const target = old ? new Set(Object.keys(tiles).map(blockOf)) : blocks;
    for (const [b, t] of groupByBlock(tiles, target)) localStorage.setItem(blockKey(world, b), JSON.stringify(t));
    if (old) localStorage.removeItem(storageKey(world));
  } catch {
    // 容量超過などで保存出来ない時は、メモリ上の地図だけで続ける
  }
}

const recordable = (map: MapEvent) =>
  !!map.pos && map.size === 7 && map.style === "solid" && map.cells.length === 49;

/** 1フレームで変わったマスだけを返す(prev は変えない)。変わったマスが無ければ null */
export function absorb(prev: Tiles, map: MapEvent): Tiles | null {
  if (!recordable(map)) return null;
  const { x, y } = map.pos!;
  let next: Tiles | null = null;
  map.cells.forEach((cell, i) => {
    if (cell.chip === UNKNOWN) return;
    const k = `${x + (i % 7) - 3},${y + Math.floor(i / 7) - 3}`;
    const old = prev[k];
    if (old && old.chip === cell.chip && old.attr === cell.attr) return;
    next ??= {};
    next[k] = { chip: cell.chip, attr: cell.attr };
  });
  return next;
}

/**
 * 中央に通常マップ、外周(幅 ring)に記録地図を置いた盤面。中央の '?' も記録があれば埋める。
 * recalled は記録地図から描くマスで、描く側が暗くする。キャラは中央へずらす。
 * 合成出来ない(座標が無い・回転マップ・ring が 0)時は null
 */
export function compose(
  map: MapEvent,
  tiles: Tiles,
  ring: number,
): { dim: number; cells: MapCell[]; recalled: boolean[]; chars: MapChar[] } | null {
  if (!recordable(map) || ring <= 0) return null;
  const R = ring;
  const dim = 7 + 2 * R;
  const half = (dim - 1) / 2;
  const { x, y } = map.pos!;
  const cells: MapCell[] = [];
  const recalled: boolean[] = [];
  for (let r = 0; r < dim; r++) {
    for (let c = 0; c < dim; c++) {
      const i = r * dim + c;
      const inner = r >= R && r < R + 7 && c >= R && c < R + 7;
      const live = inner ? map.cells[(r - R) * 7 + (c - R)] : undefined;
      if (live && live.chip !== UNKNOWN) {
        cells[i] = live;
        recalled[i] = false;
        continue;
      }
      const tile = tiles[`${x + c - half},${y + r - half}`];
      // 記録が無い外周は、視界外と同じ '?' で埋める
      cells[i] = tile ?? live ?? { chip: UNKNOWN, attr: 0 };
      recalled[i] = tile !== undefined;
    }
  }
  return { dim, cells, recalled, chars: map.chars.map((ch) => ({ ...ch, x: ch.x + R, y: ch.y + R })) };
}
