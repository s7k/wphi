/**
 * phi-client-web の frontend/src/lib/mapRender.ts をそのまま持ち込んだもの(型の import 先だけ変更)。
 *
 * マップ描画ロジック(map_widget.py 移植)。Canvas非依存の純粋関数群。
 *
 * - チップ: chip byte → index(CHIP_BYTE_TO_INDEX)。チップシートから矩形抽出。
 * - キャラ: dir(B/R/F/L=行0-3)・通常(16px)/巨大('*',32px)フレーム。
 * - アイテム: attribute bit 0x70 由来の item_no。
 * - 看板: attribute bit 0x08。
 *
 * 寸法(GraCache.cpp / map_widget.py):
 *   チップセル on-screen: 32px。チップシート: 1024×96(画像512 + マスク512、上下48分割)。
 *   既に透過PNG化済(512×96, 32×48セル/16列×2行)を配信前提([06])。
 */

import type { MapCell, MapEvent } from './protocol';

// ── チップ ────────────────────────────────────────────────

/** チップ画面セルサイズ(px)。 */
export const CHIP_SIZE = 32;
/** チップシート1セルの高さ(px)。上16px透過。 */
export const CHIP_HEIGHT = 48;
/**
 * マップの上の余白(px)。一番上の行のチップのはみ出し(48-32)の分。
 * Philly のマップのバッファも 7マス + 16px の高さで、一番上の行の壁やキャラの頭を切らない(Const.h MAP_BUFFER_HEIGHT)
 */
export const MAP_TOP = CHIP_HEIGHT - CHIP_SIZE;
/** チップ総数。 */
export const CHIP_COUNT = 32;
/** 透過PNGチップシート1行あたりの列数(16)。 */
export const CHIPS_PER_ROW = 16;

/**
 * chip byte → チップindex(複数なら合成、描画順)。
 * map_widget.py CHIP_BYTE_TO_INDEX 移植。
 */
export const CHIP_BYTE_TO_INDEX: Readonly<Record<number, number | number[]>> = {
  [' '.charCodeAt(0)]: 0,
  [':'.charCodeAt(0)]: 1,
  ['+'.charCodeAt(0)]: 2,
  ['T'.charCodeAt(0)]: [1, 3], // ground + tree overlay
  ['_'.charCodeAt(0)]: 4, // water
  ['o'.charCodeAt(0)]: 5,
  ['@'.charCodeAt(0)]: 6,
  ['#'.charCodeAt(0)]: 7,
  ['H'.charCodeAt(0)]: 8,
  ['I'.charCodeAt(0)]: 9,
  ['='.charCodeAt(0)]: 10,
  ['['.charCodeAt(0)]: 11,
  ['{'.charCodeAt(0)]: 12,
  ['|'.charCodeAt(0)]: 13,
  ['x'.charCodeAt(0)]: 14,
  ['%'.charCodeAt(0)]: 15,
  ['/'.charCodeAt(0)]: 16,
  ['>'.charCodeAt(0)]: 17,
  ['?'.charCodeAt(0)]: 31, // unknown area
  ['s'.charCodeAt(0)]: 0,
};

/** chip byte → 描画するチップindex配列(常に配列化、default=0)。 */
export function chipIndices(chipByte: number): number[] {
  const v = CHIP_BYTE_TO_INDEX[chipByte] ?? 0;
  return Array.isArray(v) ? v : [v];
}

/** 有効チップindexか(0..CHIP_COUNT-1)。範囲外は描画スキップ対象。 */
export function chipIndexValid(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CHIP_COUNT;
}

/**
 * 透過PNGチップシート上の index → 矩形(sx,sy,sw,sh)。
 * 範囲外indexは null(移植元 `_ChipRenderer.draw` の `idx >= len(chips)` スキップ準拠)。
 */
export function chipSrcRect(index: number): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
} | null {
  if (!chipIndexValid(index)) return null;
  const col = index % CHIPS_PER_ROW;
  const row = Math.floor(index / CHIPS_PER_ROW);
  return {
    sx: col * CHIP_SIZE,
    sy: row * CHIP_HEIGHT,
    sw: CHIP_SIZE,
    sh: CHIP_HEIGHT,
  };
}

// ── チップ合成クラス(拡大表示 scale=2 用) ────────────────────
// 64pxセルを32px原画から合成する際の埋め方。引き伸ばし一辺倒を避ける。
//   tile   : 床/水/草など平面 → 本体32×32を2×2にタイル敷き(くっきり)
//   center : 箱/小物など → 32×32を本体中央へ1枚
//   stretch: 壁/木/扉など段差あり(オーバーハング)→ 2x拡大(高さ保持)
export type ChipClass = 'tile' | 'stretch' | 'center';

/** index→クラス(既定 stretch)。実画面で目視調整する前提の初期分類。 */
export const CHIP_CLASS: Readonly<Record<number, ChipClass>> = {
  // 平面(床/水/草系)
  0: 'tile',
  1: 'tile',
  2: 'tile',
  4: 'tile',
  5: 'tile',
  // 壁/木/扉/構造物は段差を保つため stretch(既定なので明示不要だが意図を残す)
  6: 'stretch',
  7: 'stretch',
  8: 'stretch',
};

/** チップindexの合成クラス。未登録は 'stretch'。 */
export function chipClass(index: number): ChipClass {
  return CHIP_CLASS[index] ?? 'stretch';
}

// ── 看板 ────────────────────────────────────────────────

/** 看板overlay用 硬質面チップbyte(壁/扉等)。 */
const HARD_BOARD_CHIPS: ReadonlySet<number> = new Set(
  ['@', '#', 'H', '=', '[', '{', '|', '%'].map((c) => c.charCodeAt(0)),
);
/** 看板overlay: 軟質床/水上。 */
export const BOARD_CHIP_SOFT = 18;
/** 看板overlay: 壁/扉等。 */
export const BOARD_CHIP_HARD = 20;

/** attribute bit 0x08(看板)が立っているか。 */
export function hasBoard(attr: number): boolean {
  return (attr & 0x08) !== 0;
}

/** 看板overlayに使うチップindex(下地が硬質面か否かで分岐)。 */
export function boardChipIndex(chipByte: number): number {
  return HARD_BOARD_CHIPS.has(chipByte) ? BOARD_CHIP_HARD : BOARD_CHIP_SOFT;
}

// ── アイテム ────────────────────────────────────────────────

/** アイテムスプライト1枚サイズ(px)。 */
export const ITEM_SPRITE_SIZE = 32;

/** attribute bit 0x70(アイテム)が立っているか。 */
export function hasItem(attr: number): boolean {
  return (attr & 0x70) !== 0;
}

/** attribute → item_no(0-7)。(attr & 0x70) >> 4。 */
export function itemNo(attr: number): number {
  return (attr & 0x70) >> 4;
}

/** 床に落ちている物の絵 (32x32 を横に並べた 1 枚。先頭の 8 枚が item_no)。phi-client-web の PCGL の items.png */
export const FLOOR_ITEMS_URL = new URL("./pcglItems.png", import.meta.url).href;

/** floorItems.png 上の item_no → 矩形。 */
export function itemSrcRect(no: number): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
} {
  return {
    sx: no * ITEM_SPRITE_SIZE,
    sy: 0,
    sw: ITEM_SPRITE_SIZE,
    sh: ITEM_SPRITE_SIZE,
  };
}

/** 防御円チップbyte('x'=14, '%'=15)。円内に収めるためアイテム上端をクリップ。 */
const CIRCLE_CHIPS: ReadonlySet<number> = new Set(
  ['x', '%'].map((c) => c.charCodeAt(0)),
);

/** 防御円チップか('x'/'%')。 */
export function isCircleChip(chipByte: number): boolean {
  return CIRCLE_CHIPS.has(chipByte);
}

/** アイテムを床の上端から上げる量(px)。Philly の YPos+8 と床の YPos+16 の差 */
export const ITEM_Y_ABOVE_FLOOR = 8;

/**
 * キャラを床の上端から上げる量(px)。Philly はキャラを YPos+CHARACTER_HEIGHT_OFFSET(32/6=5)に描き
 * (MakeMap.cpp DrawOneCharaGra)、床は YPos+16 から始まるので、その差
 */
export const CHARA_Y_ABOVE_FLOOR = 11;

/** アイテムクリップ高(円内に収める可視高 = 32-11)。 */
export const ITEM_CLIP_H = ITEM_SPRITE_SIZE - 11; // 21

/**
 * アイテム描画の src/dst 矩形を算出(map_widget.py `_ItemRenderer.draw` 移植)。
 *
 * - 通常セル: 32×32 を (col*cs, row*cs+8) に等倍描画。
 * - 防御円('x'/'%')上: 上11pxをクリップし高21pxのみ描画(円内に収める)。
 *   item_no 5/6 はスプライト先頭が空きのため src_y を +5 して内容をずらす。
 *
 * @param no       item_no(0-7)。
 * @param chipByte 下地チップbyte(防御円判定)。
 * @param dstX     セル左上X(col*cs)。
 * @param dstY     セル左上Y(row*cs)。
 * @param scale    描画倍率(1=等倍 / 2=拡大)。dst サイズ・オフセットに乗じる(src は不変)。
 */
export function itemDrawRect(
  no: number,
  chipByte: number,
  dstX: number,
  dstY: number,
  scale = 1,
): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
} {
  const s = ITEM_SPRITE_SIZE;
  const srcX = no * s;
  // Philly はチップ(高さ48)を YPos から描き、床はその16px下から始まる。アイテムは YPos+8(MakeMap.cpp DrawItem)、
  // つまり床の上端の8px上に描き、箱などの上に乗って見える。dstY は床の上端なので 8px 上げる。拡大時は ×scale
  const drawY = dstY - ITEM_Y_ABOVE_FLOOR * scale;

  if (isCircleChip(chipByte)) {
    // DrawPart: 上11pxクリップで可視21pxのみ。item 5/6 は内容を src_y+5。
    const srcYOffset = no === 5 || no === 6 ? 5 : 0;
    return {
      sx: srcX,
      sy: srcYOffset,
      sw: s,
      sh: ITEM_CLIP_H,
      dx: dstX,
      dy: drawY,
      dw: s * scale,
      dh: ITEM_CLIP_H * scale,
    };
  }
  return { sx: srcX, sy: 0, sw: s, sh: s, dx: dstX, dy: drawY, dw: s * scale, dh: s * scale };
}

// ── キャラ ────────────────────────────────────────────────

/** dir文字 → チップシート行(0-3)。 */
const DIR_TO_ROW: Readonly<Record<string, number>> = {
  B: 0, // Back / North
  R: 1, // Right / East
  F: 2, // Front / South
  L: 3, // Left / West
};

/**
 * map.dir 数値(A-06: N=0,NE=1,E=2,SE=3,S=4,SW=5,W=6,NW=7) → 相対dir文字。
 * キャラ向きは B/R/F/L で送られる前提(A-05)だが、数値が来た場合のため変換も用意。
 * 8方向を最寄りの B(N)/R(E)/F(S)/L(W) 4方向へ丸める。
 */
const DIR_NUM_TO_CHAR: Readonly<Record<number, 'B' | 'R' | 'F' | 'L'>> = {
  0: 'B', // N
  1: 'B', // NE → N
  2: 'R', // E
  3: 'F', // SE → S
  4: 'F', // S
  5: 'F', // SW → S
  6: 'L', // W
  7: 'B', // NW → N
};

/** キャラdir(文字/数値) → チップシート行(0-3)。既定は F(2, 正面)。 */
export function dirToRow(dir: string | number): number {
  if (typeof dir === 'number') {
    const c = DIR_NUM_TO_CHAR[dir & 7] ?? 'F';
    return DIR_TO_ROW[c];
  }
  return DIR_TO_ROW[dir] ?? DIR_TO_ROW.F;
}

/** gigant フラグが巨大('*')か。 */
export function isGiant(gigant: string | undefined): boolean {
  return gigant === '*';
}

/** gigant フラグが 2x2 の大きな敵('B')か。phidm-v6 と PHIDM_NEO の phi.ed :O B の敵 */
export function isBig(gigant: string | undefined): boolean {
  return gigant === 'B';
}

/**
 * キャラが塞ぐ盤面のマス。普通は立っているマス、2x2 の大きな敵('B')は 4 マス。
 * サーバは大きな敵を基準マス(地図の北西の角)に 1 行だけ送り、体は地図の東・南・南東に広がる。
 * 回転マップでは、盤面の上が向き dir(0 北、2 東、4 南、6 西。#v6 M・#m57 の向き)なので、その分回す
 */
export function charCells(c: { x: number; y: number; gigant?: string }, dir = 0): { x: number; y: number }[] {
  if (!isBig(c.gigant)) return [{ x: c.x, y: c.y }];
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([ex, ey]) => {
    let [x, y] = [ex, ey];
    // 地図で東を向くと、地図の東が盤面の上、地図の南が盤面の右になる。向きの 1/4 回転ごとに (x, y) → (y, -x)
    for (let i = 0; i < ((dir >> 1) & 3); i++) [x, y] = [y, -x];
    return { x: c.x + x, y: c.y + y };
  });
}

/**
 * 1行のキャラを描く順と、横にずらす量(等倍の px)。(x, layer) の順に描く(Philly の SetCharaGraData)。
 * 同じマスに2人いる時(#42。Philly の DrawOneLineCharaGra を作者の指定で変えた)
 * - 16x32 が2人: 左右に8pxずつずらして並べる(Philly と同じ)
 * - 32x32 と 16x32: 32x32 を先(下)に描き、16x32 を後(上)にして右へ8px寄せる
 * 3人以上や 32x32 が2人の時はずらさない
 */
export function arrangeRow<T extends { x: number; layer: number; gigant: string }>(
  chars: T[],
): { ch: T; dx: number }[] {
  const sorted = [...chars].sort((a, b) => a.x - b.x || a.layer - b.layer);
  const out: { ch: T; dx: number }[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].x === sorted[i].x) j++;
    const cell = sorted.slice(i, j);
    i = j;
    if (cell.length === 2) {
      const [a, b] = cell;
      const ga = isGiant(a.gigant);
      const gb = isGiant(b.gigant);
      if (!ga && !gb) {
        out.push({ ch: a, dx: -8 }, { ch: b, dx: 8 });
        continue;
      }
      if (ga !== gb) {
        const [big, small] = ga ? [a, b] : [b, a];
        out.push({ ch: big, dx: 0 }, { ch: small, dx: 8 });
        continue;
      }
    }
    for (const ch of cell) out.push({ ch, dx: 0 });
  }
  return out;
}

/** キャラ通常フレーム幅(px)。 */
export const CHARA_W_NORMAL = 16;
/** キャラ巨大フレーム幅(px)。 */
export const CHARA_W_GIANT = 32;
/** キャラ1フレーム高(px)。 */
export const CHARA_H = 32;

/**
 * キャラスプライトのソース矩形を計算。
 * 96px幅レイアウト: [小frame0=16][小frame1=16][大frame0=32][大frame1=32]
 * 行 = dir(B/R/F/L)。frame = anim(0/1)。
 *
 * @param dir   キャラ向き(文字 or 数値)。
 * @param gigant '*'=巨大 / それ以外=通常。
 * @param animFrame アニメフレーム(0/1, 内部で &1)。
 * @param large 拡大表示モード等で、通常キャラでも右側32×32フレームを使う。
 *   巨大('*')は元々大フレーム。large=true で通常キャラも大フレームへ。
 */
export function charaSrcRect(
  dir: string | number,
  gigant: string | undefined,
  animFrame = 0,
  large = false,
): { sx: number; sy: number; sw: number; sh: number } {
  const row = dirToRow(dir);
  const frame = animFrame & 1;
  const sy = row * CHARA_H;

  if (large || isGiant(gigant)) {
    // 大フレームは通常2枚の後ろ: x=32(frame0) / 64(frame1)
    const sx = CHARA_W_NORMAL * 2 + frame * CHARA_W_GIANT;
    return { sx, sy, sw: CHARA_W_GIANT, sh: CHARA_H };
  }
  // 通常フレーム: x=0(frame0) / 16(frame1)
  const sx = frame * CHARA_W_NORMAL;
  return { sx, sy, sw: CHARA_W_NORMAL, sh: CHARA_H };
}

// ── 巨大キャラ magnify(#ex-obj) ────────────────────────────

/** magnify パラメータ。w/h=拡大描画サイズ(px)、z=垂直オフセット(px)。 */
export interface Magnify {
  w: number;
  h: number;
  z: number;
}

/** magnify 適用後の描画矩形(dst)。 */
export interface MagnifiedDst {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * 巨大キャラ拡大描画の描画先矩形を計算。
 * map_widget.py `_CharaRenderer.draw` の magnify 補正を移植。
 *
 *   base_x -= (w - CHARA_H) / 2          ; 水平センタリング
 *   base_y -= (h - CHARA_H) * 5 / 6 + z  ; 足元基準の垂直補正
 *   draw_w = w ; draw_h = h
 *
 * @param baseX magnify非適用時の描画原点X(セル中央寄せ済)。
 * @param baseY magnify非適用時の描画原点Y(セル中央寄せ済)。
 * @param m     magnify パラメータ。
 * @returns 拡大後の dst 矩形。
 *
 * 床除算(Python `//`)に合わせ Math.floor を使用。
 */
export function magnifiedDst(baseX: number, baseY: number, m: Magnify): MagnifiedDst {
  const dx = baseX - Math.floor((m.w - CHARA_H) / 2);
  const dy = baseY - (Math.floor(((m.h - CHARA_H) * 5) / 6) + m.z);
  return { dx, dy, dw: m.w, dh: m.h };
}

// ── 水縁エフェクト(DrawWaterEffect / _Q_TABLE) ───────────────

/** 水縁チップのベースindex(frame0固定、水アニメ無し)。 */
export const WATER_CHIP_BASE = 23;
/** 水チップのbyte('_')。 */
export const WATER_BYTE = '_'.charCodeAt(0);

/**
 * 水縁 quarter 描画テーブル。
 * map_widget.py `_Q_TABLE` 移植(classMakeMap::DrawWaterEffect)。
 *
 * 添字 = quarter(0=TL,1=TR,2=BL,3=BR)。
 * 各 quarter で 3bit パターン → [chip_offset, src_quarter]。
 * パターン 0x07(全隣接=水) → entry無し(overlay不要)。
 */
export const Q_TABLE: ReadonlyArray<Readonly<Record<number, readonly [number, number]>>> = [
  // Quarter 0 (TL): bit0=TL対角, bit1=上, bit2=左
  { 0x00: [1, 0], 0x01: [1, 0], 0x02: [0, 0], 0x03: [0, 0], 0x04: [0, 2], 0x05: [0, 2], 0x06: [2, 3] },
  // Quarter 1 (TR): bit0=TR対角, bit1=上, bit2=右
  { 0x00: [1, 1], 0x01: [1, 1], 0x02: [0, 1], 0x03: [0, 1], 0x04: [0, 2], 0x05: [0, 2], 0x06: [2, 2] },
  // Quarter 2 (BL): bit0=BL対角, bit1=下, bit2=左
  { 0x00: [1, 2], 0x01: [1, 2], 0x02: [0, 0], 0x03: [0, 0], 0x04: [0, 3], 0x05: [0, 3], 0x06: [2, 1] },
  // Quarter 3 (BR): bit0=BR対角, bit1=下, bit2=右
  { 0x00: [1, 3], 0x01: [1, 3], 0x02: [0, 1], 0x03: [0, 1], 0x04: [0, 3], 0x05: [0, 3], 0x06: [2, 0] },
];

/**
 * 水セルの上下左右+斜めの水有無から各quarterの3bitパターンを計算。
 * map_widget.py `_render_visible` の patterns 計算移植。
 *
 * water[r][c]=1(水) の (rows+2)×(cols+2) 配列を前提(枠=0)。
 * 引数 wy,wx は water配列上の対象セル左上(=grid座標 row,col)。
 *
 * @returns [Q0,Q1,Q2,Q3] の3bitパターン。
 */
export function waterQuarterPatterns(
  water: ReadonlyArray<ReadonlyArray<number>>,
  wy: number,
  wx: number,
): [number, number, number, number] {
  return [
    water[wy][wx] | (water[wy][wx + 1] << 1) | (water[wy + 1][wx] << 2), // Q0 TL
    water[wy][wx + 2] | (water[wy][wx + 1] << 1) | (water[wy + 1][wx + 2] << 2), // Q1 TR
    water[wy + 2][wx] | (water[wy + 2][wx + 1] << 1) | (water[wy + 1][wx] << 2), // Q2 BL
    water[wy + 2][wx + 2] | (water[wy + 2][wx + 1] << 1) | (water[wy + 1][wx + 2] << 2), // Q3 BR
  ];
}

/**
 * quarter のパターンから描画する水縁チップ overlay を解決。
 * @returns null=overlay不要(0x07等)、else={chipIndex, srcQuarter}。
 */
export function waterQuarterChip(
  qIdx: number,
  pattern: number,
): { chipIndex: number; srcQuarter: number } | null {
  const entry = Q_TABLE[qIdx]?.[pattern];
  if (!entry) return null;
  return { chipIndex: WATER_CHIP_BASE + entry[0], srcQuarter: entry[1] };
}

/**
 * チップindex + quarter(0=TL,1=TR,2=BL,3=BR) → チップシート上の16×16矩形。
 * チップ内容領域は y=16 から始まる(上16px透過)。
 * map_widget.py `_ChipRenderer.draw_quarter` 移植。
 */
export function chipQuarterSrcRect(
  chipIndex: number,
  quarter: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const base = chipSrcRect(chipIndex);
  if (!base) return null;
  const half = CHIP_SIZE / 2; // 16
  const sx = base.sx + (quarter & 1) * half;
  // 内容はチップ先頭から16px下。上16px透過 + quarter下段でさらに+16。
  const sy = base.sy + (CHIP_HEIGHT - CHIP_SIZE) + ((quarter >> 1) & 1) * half;
  return { sx, sy, sw: half, sh: half };
}

/**
 * cells配列から水有無の (height+2)×(width+2) 配列を構築(枠=0)。
 * water[r+1][c+1] = (cells[idx].chip == '_') ? 1 : 0。
 */
export function buildWaterGrid(cells: ReadonlyArray<MapCell>, width: number, height: number): number[][] {
  const w: number[][] = [];
  for (let r = 0; r < height + 2; r++) w.push(new Array(width + 2).fill(0));
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const cell = cells[cellIndex(c, r, width)];
      if (cell && cell.chip === WATER_BYTE) w[r + 1][c + 1] = 1;
    }
  }
  return w;
}

// ── グリッド ────────────────────────────────────────────────

/** '?'(見えない所)のチップ */
export const UNKNOWN = '?'.charCodeAt(0);

/**
 * 地図の欄の長さ(px)に入るマス数を、奇数に切り下げた物。v6 で要求する視界の幅か高さ(3〜99)
 */
export function viewFor(px: number, cell: number): number {
  const n = Math.floor(px / cell);
  return Math.max(3, Math.min(99, n % 2 ? n : n - 1));
}

/** 窓を覆うマス数。viewFor と違い、奇数へ切り上げる(はみ出す分は窓の外。モダンで地図の周りを空けない為) */
export function viewCover(px: number, cell: number): number {
  const n = Math.ceil(px / cell);
  return Math.max(3, Math.min(99, n % 2 ? n : n + 1));
}

/**
 * 地図のうち窓に見せる範囲。x, y はその左上の、地図の中の位置。v6 でない地図(7x7)は全部見せる。
 * v6 は窓より上下左右に1マスずつ多く求める(session.rs の view_line)ので、届いた地図の外周は窓の外に置き、
 * スムーズ移動でずらした時に窓に入る端に使う。サーバが上限で小さく返した時も外周は窓の外に置き、見せる範囲が窓より狭くなる。
 * 5 マスより小さく、外周を除くと 3 マスに足りない時は外周も見せる。
 * 見せる範囲の自キャラが、見せる大きさで決まる位置(selfPos)に来るように置く。北固定は中央。
 * 回転は自キャラが地図の大きさ M で決まる位置にいるので、外周が上と下で1マスずつとは限らない
 * (M=11 の自キャラは 7 行目、見せる 9x9 の自キャラは 5 行目なので、上に2行、下に0行)
 */
export function viewArea(map: MapEvent, w: number, h: number): { x: number; y: number; w: number; h: number } {
  if (!map.v6) return { x: 0, y: 0, w: map.width, h: map.height };
  const fit = (n: number, want: number) => Math.min(want, n < 5 ? n : n - 2);
  const turn = map.style === 'turn';
  const [vw, vh] = [fit(map.width, w), fit(map.height, h)];
  const all = selfPos(map.width, map.height, turn);
  const shown = selfPos(vw, vh, turn);
  return { x: all.x - shown.x, y: all.y - shown.y, w: vw, h: vh };
}

/**
 * 描くマスの範囲(列 c0..c1、行 r0..r1)。見せる範囲 view に、スムーズ移動のずらし(slide px)で窓に入る外側の列と行を足す。
 * それより外のマスは描かない。窓のすぐ下の行のチップのはみ出しや、窓の外のキャラの名前が窓に掛かる為
 */
export function drawRange(
  view: { x: number; y: number; w: number; h: number },
  slide: { x: number; y: number },
  width: number,
  height: number,
  cs: number,
): { c0: number; c1: number; r0: number; r1: number } {
  const cells = (px: number) => Math.ceil(Math.max(0, px) / cs);
  return {
    c0: Math.max(0, view.x - cells(slide.x)),
    c1: Math.min(width - 1, view.x + view.w - 1 + cells(-slide.x)),
    r0: Math.max(0, view.y - cells(slide.y)),
    r1: Math.min(height - 1, view.y + view.h - 1 + cells(-slide.y)),
  };
}

/**
 * 自キャラのマス(左上を 0 とする列と行)。北固定は中央。
 * 回転は前が上で、後ろに ⌊h/3⌋ 行見える(サーバの phi_m57.rs の set_view7 の SP。7x7 は前 4 行、後ろ 2 行)
 */
export function selfPos(w: number, h: number, turn: boolean): { x: number; y: number } {
  return { x: (w - 1) >> 1, y: turn ? h - 1 - Math.floor(h / 3) : (h - 1) >> 1 };
}

/** (x,y) → cells配列index(行優先, index=y*size+x)。 */
export function cellIndex(x: number, y: number, size: number): number {
  return y * size + x;
}

/** スムーズ移動の、自分の位置とその時刻(ms。窓をまたいで比べる絶対の時刻) */
export type WalkSample = { at: number; x: number; y: number };

/**
 * スムーズ移動で、見せる位置を今より遅らせる時間(ms)の下限と上限。
 * 見せるのは「今より少し前の時刻の位置」で、届いた位置の間を直線で補う。届くのが遅れても(窓の間の受け渡しで 7〜26ms 揺れる)
 * 動く速さは変わらない。下限は、止まっていた後の1歩目の時間(SLIDE_FIRST_MS)に、受け渡しの遅れを足した物
 */
export const SLIDE_MIN_MS = 130;
export const SLIDE_MAX_MS = 250;
/** 止まっていた後の1歩目を滑らせる時間。サーバは 0.1 秒に1歩 */
export const SLIDE_FIRST_MS = 100;

/** 新しい位置を足す。止まっていた後(前の位置から SLIDE_MAX_MS より空いた)の1歩目は、その SLIDE_FIRST_MS 前まで前の位置にいた事にする。古い分は捨てる */
export function addWalk(samples: WalkSample[], s: WalkSample): WalkSample[] {
  const last = samples[samples.length - 1];
  const out = [...samples];
  if (last && s.at - last.at > SLIDE_MAX_MS) out.push({ ...last, at: s.at - SLIDE_FIRST_MS });
  out.push(s);
  return out.slice(-8);
}

/** 遅らせる時間。続けて歩いている間の最近の間隔の最大を、下限と上限で挟む。間隔より短いと、次の位置が届く前に追いついて止まる */
export function walkDelay(samples: WalkSample[]): number {
  let d = SLIDE_MIN_MS;
  for (let i = 1; i < samples.length; i++) {
    const gap = samples[i].at - samples[i - 1].at;
    if (gap <= SLIDE_MAX_MS) d = Math.max(d, gap + SLIDE_MIN_MS - SLIDE_FIRST_MS);
  }
  return Math.min(SLIDE_MAX_MS, d);
}

/** 時刻 t に見せる位置。前後の位置の間を直線で補う。最初より前は最初、最後より後は最後 */
export function walkAt(samples: WalkSample[], t: number): { x: number; y: number } {
  const i = samples.findIndex((s) => s.at > t);
  const only = (s: WalkSample) => ({ x: s.x, y: s.y });
  if (i === 0) return only(samples[0]);
  if (i < 0) return only(samples[samples.length - 1]);
  const [a, b] = [samples[i - 1], samples[i]];
  const k = (t - a.at) / (b.at - a.at);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/**
 * 1歩の時間の付いた位置 (#v6 G のサーバのスムーズ移動) を経路に足す。描くのは今より SLIDE_DELAY_MS 前 (t) の位置。
 * 1歩は予定の時刻 at から at + ms まで滑らせる。前の1歩の残りはそのまま描き、続けて次の1歩を描くので、
 * 状態が少し遅れて届いても止まらず、残りを急いで縮めることもない (#146)。
 * at が t より前 (遅れすぎて届いた・外れを直す) なら、t の位置から残りを滑らせる
 */
export function timedWalk(samples: WalkSample[], t: number, at: number, ms: number, to: { x: number; y: number }, from: { x: number; y: number }): WalkSample[] {
  const start = Math.max(at, t);
  const end = Math.max(start + 16, at + ms);
  const pos = samples.length ? walkAt(samples, start) : from;
  // start より前の点のうち、t 以前は最後の 1 つだけ残せば t の位置を補間出来る
  const before = samples.filter((s) => s.at < start);
  let first = 0;
  before.forEach((s, i) => {
    if (s.at <= t) first = i;
  });
  return [...before.slice(first), { at: start, ...pos }, { at: end, ...to }];
}

/** スムーズ移動で描く位置を、今よりこれだけ前にする (ms)。main 窓から状態が届く遅れ (7〜26ms) を覆う */
export const SLIDE_DELAY_MS = 30;

/**
 * 自分の位置が前から何マス動いたか。ずらして見せる時だけ返す。
 * 世界が違う時(world に epoch を含めると、テレポートやタブの切り替えも)、動いていない時、3マス以上飛んだ時は null
 */
export function slideStep(
  last: { world?: string; x: number; y: number } | null,
  now: { world?: string; x: number; y: number },
): { dx: number; dy: number } | null {
  if (!last || last.world !== now.world) return null;
  const dx = now.x - last.x;
  const dy = now.y - last.y;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  return n === 0 || n > 2 ? null : { dx, dy };
}

/** マスの世界の座標から決まる 32bit の値 */
export function cellHash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 木の揺らぎ。マスの中のずれ(px、等倍)。左右反転はしない(チップの陰影の向きが逆になる) */
export function treeJitter(h: number): { dx: number; dy: number } {
  return { dx: ((h >>> 8) % 7) - 3, dy: ((h >>> 12) % 5) - 2 };
}

/**
 * 草のマスの揺らぎ。小さな飾り(草の房か小石)とその位置(px、等倍)。
 * 飾りは下地の色を暗く・明るくするだけの半透明の点で描くので、世界のチップの色を選ばない。
 * マスごとに明るさを変える事は試したが、マスの四角い縁が浮いて見えたのでやめた
 */
export function grassJitter(h: number): { deco: 'tuft' | 'pebble' | null; x: number; y: number } {
  const r = (h >>> 4) % 100;
  return {
    deco: r < 14 ? 'tuft' : r < 19 ? 'pebble' : null,
    x: 4 + ((h >>> 11) % 22),
    y: 6 + ((h >>> 16) % 20),
  };
}
