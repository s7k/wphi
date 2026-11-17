/**
 * phi-client-web の frontend/src/lib/drawMap.ts を持ち込んだもの。
 * キャラグラの代替解決は Rust 側の画像配信(src-tauri/src/assets.rs)が行うので、
 * ここでは表示名・グラ名・種別から URL を作るだけにした。看板の題名(signs)は外した。
 *
 * Canvas 2D へのマップ描画(map_widget.py paintEvent 移植の中核)。
 * MapView から CanvasRenderingContext2D と画像群を受け取り描画。
 *
 * 画像参照は ImageRefs で抽象化(テストでは ctx をモック)。
 */
import type { MapCell, MapChar } from './protocol';
import { charaUrl } from './asset';
import {
  CHARA_H,
  CHIP_HEIGHT,
  CHIP_SIZE,
  boardChipIndex,
  charaSrcRect,
  chipClass,
  chipIndices,
  chipSrcRect,
  cellIndex,
  hasBoard,
  hasItem,
  itemNo,
  itemDrawRect,
  arrangeRow,
  CHARA_Y_ABOVE_FLOOR,
  buildWaterGrid,
  waterQuarterPatterns,
  waterQuarterChip,
  chipQuarterSrcRect,
  magnifiedDst,
  WATER_BYTE,
  drawRange,
  cellHash,
  grassJitter,
  treeJitter,
  unknownKinds,
  roofCells,
} from './mapRender';

/** drawMap が参照する画像群。null/undefined は未ロード扱いで描画スキップ。 */
export interface ImageRefs {
  /** mapsetチップシート(透過PNG)。 */
  chip?: HTMLImageElement | null;
  /** 属性の下位2ビット(#mapset-define の番号)のチップシート。無ければ chip を使う */
  chipOf?: (define: number) => HTMLImageElement | null | undefined;
  /** items.png。 */
  items?: HTMLImageElement | null;
  /** キャラグラの URL → 画像。未ロードは undefined、読めなかった時は null。 */
  chara: (url: string) => HTMLImageElement | null | undefined;
}

export interface DrawMapInput {
  /** 盤面の幅と高さ(マス) */
  width: number;
  height: number;
  mapset: string;
  cells: MapCell[];
  chars: MapChar[];
  cells0Based?: boolean;
  /**
   * EagleEye の盤面(Philly の EagleEye.cpp classEagleEye::Draw)。アイテムはマップチップの 19 番で描き(#14)、
   * 人はマスの床の上端に描く(Philly は YPos+16。通常のマップのキャラのように上げない)
   */
  eagleEye?: boolean;
  /** 自キャラのマス(mapRender.ts の selfPos)。省略時は中央 */
  self?: { x: number; y: number };
  /**
   * 実験的: 自キャラのマス以外をずらして描く量(px)。自分が進んだ時に、前の位置から滑らかに動いて見せる。
   * 自キャラはずらさない
   */
  slide?: { x: number; y: number };
  /** 窓に見せる範囲(mapRender.ts の viewArea)。canvas の左上に (x, y) のマスが来る。省略時は全部 */
  view?: { x: number; y: number; w: number; h: number };
  /**
   * スムーズ移動で、描いた地図をずらして写す時(map.tsx)。others は自キャラ以外を描き、self は自キャラだけを
   * 消さずに上へ描く
   */
  only?: 'self' | 'others';
  /**
   * スムーズ移動で、自キャラの後ろと前に分けて描く時(map.tsx)。back は rows より上の行を描き、front は rows から下の行を
   * 透明の上に描いてキャラの名前も描く。止まっている時と同じく、下の行の壁が自キャラに重なるようにする為
   */
  split?: { row: number; part: 'back' | 'front' };
  /**
   * 盤面の (0, 0) のマスの、世界の座標(#ex-pos か #v6 G で数えた位置から決める)。あれば、木と草のマスに座標で決まる揺らぎを付ける
   * (木のずれ、草の小さな草の房・小石)。同じ場所はいつも同じ見え方になる
   */
  origin?: { x: number; y: number };
  /**
   * 見えないマス('?')の描き方。black はチップのまま(真っ黒)、fog は暗い霧にして境目をぼかし、
   * roof は壁で囲まれた所に屋根を乗せて残りはチップのまま描く(mapRender.ts の unknownKinds、roofCells)。map.tsx は v6 の地図で roof にする。
   * roof で霧を使わないのは、境目のぼかしが隣の壁(レンガ)にはみ出してノイズに見えた為
   * 真っ黒の四角は穴に見え、壁の内側に平らに描いた屋根は壁より低く凹んで見えた為、屋根は壁の高さだけ持ち上げて壁の上に乗せる
   */
  unknown?: 'black' | 'fog' | 'roof';
}

/** 壁のチップが上へはみ出す高さ(px、等倍)。屋根をこの分だけ持ち上げる */
const CHIP_HEIGHT_ABOVE = 16;

/** 霧の色 */
const FOG = [27, 32, 38];
/** 屋根の色(瓦の地) */
const ROOF = '#8a4a3a';

/** 見えないマスを霧で塗る */
function drawFog(ctx: CanvasRenderingContext2D, col: number, row: number, cs: number) {
  ctx.fillStyle = `rgb(${FOG.join(',')})`;
  ctx.fillRect(col * cs, row * cs, cs, cs);
}

/** 見えるマスの、霧に接する辺から内側へ、霧をぼかして重ねる。side は 0 上、1 右、2 下、3 左 */
function drawFogEdge(ctx: CanvasRenderingContext2D, col: number, row: number, side: number, cs: number, scale: number) {
  const d = 12 * scale;
  const [x0, y0] = [col * cs, row * cs];
  const box = [
    [x0, y0, x0, y0 + d, x0, y0, cs, d],
    [x0 + cs, y0, x0 + cs - d, y0, x0 + cs - d, y0, d, cs],
    [x0, y0 + cs, x0, y0 + cs - d, x0, y0 + cs - d, cs, d],
    [x0, y0, x0 + d, y0, x0, y0, d, cs],
  ][side];
  const g = ctx.createLinearGradient(box[0], box[1], box[2], box[3]);
  g.addColorStop(0, `rgba(${FOG.join(',')},0.85)`);
  g.addColorStop(1, `rgba(${FOG.join(',')},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(box[4], box[5], box[6], box[7]);
}

/** 屋根のマス。瓦を 8px の段で並べ、上が屋根でなければ棟の明るい線、下が屋根でなければ軒の暗い帯を付ける */
function drawRoof(ctx: CanvasRenderingContext2D, col: number, row: number, cs: number, scale: number, top: boolean, bottom: boolean) {
  const [x0, y0] = [col * cs, row * cs];
  ctx.fillStyle = ROOF;
  ctx.fillRect(x0, y0, cs, cs);
  const step = 8 * scale;
  for (let y = 0; y < cs; y += step) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x0, y0 + y, cs, scale);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x0, y0 + y + step - scale, cs, scale);
    // 瓦の継ぎ目は段ごとに半分ずらす
    const shift = ((row * cs + y) / step) % 2 ? step / 2 : 0;
    for (let x = shift; x < cs; x += step) ctx.fillRect(x0 + x, y0 + y, scale, step);
  }
  if (top) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x0, y0, cs, 2 * scale);
  }
  if (bottom) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x0, y0 + cs - 3 * scale, cs, 3 * scale);
  }
}

/** 木のチップ(地面の上に重ねる分)と、揺らぎを付ける草のマス */
const TREE_CHIP = 3;
const GRASS_BYTE = ':'.charCodeAt(0);

function drawGrassJitter(ctx: CanvasRenderingContext2D, h: number, col: number, row: number, cs: number, scale: number) {
  const g = grassJitter(h);
  const [x0, y0] = [col * cs, row * cs];
  const dot = (style: string, x: number, y: number, w: number, h2: number) => {
    ctx.fillStyle = style;
    ctx.fillRect(x0 + (g.x + x) * scale, y0 + (g.y + y) * scale, w * scale, h2 * scale);
  };
  const dark = 'rgba(0,0,0,0.3)';
  const light = 'rgba(255,255,255,0.28)';
  if (g.deco === 'tuft') {
    dot(dark, 0, 3, 1, 4);
    dot(dark, 1, 1, 1, 6);
    dot(dark, 3, 0, 1, 7);
    dot(dark, 5, 2, 1, 5);
    dot(light, 1, 1, 1, 2);
    dot(light, 3, 0, 1, 2);
  } else if (g.deco === 'pebble') {
    dot(dark, 0, 1, 4, 2);
    dot(dark, 1, 3, 2, 1);
    dot(light, 1, 0, 2, 1);
  }
}

/** EagleEye でアイテムのマスに描くマップチップ(Philly の MapChipCache->Draw(..., 19, ...)) */
const EAGLE_EYE_ITEM_CHIP = 19;

/** マークアップ除去後の名前頭文字(placeholder用)。 */
function nameInitial(name: string): string {
  const s = name.replace(/\/\*.*?\*\//g, '').trim();
  return s.slice(0, 1) || '?';
}

/**
 * マップ全体を描画。
 *
 * @param ctx   2Dコンテキスト。
 * @param input map状態。
 * @param imgs  画像参照。
 * @param animFrame アニメフレーム(0/1)。
 * @param cellSize セル1辺px(既定32)。拡大表示は64。scale=cellSize/32(1 or 2)。
 */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  input: DrawMapInput,
  imgs: ImageRefs,
  animFrame = 0,
  cellSize: number = CHIP_SIZE,
): void {
  const { width, height } = input;
  const cs = cellSize;
  const scale = cs / CHIP_SIZE; // 1 or 2

  const view = input.view ?? { x: 0, y: 0, w: width, h: height };
  if (input.only === 'self') {
    const me = input.self ?? { x: (width - 1) >> 1, y: (height - 1) >> 1 };
    ctx.save();
    ctx.translate(-view.x * cs, -view.y * cs);
    for (const { ch, dx } of arrangeRow(input.chars.filter((c) => c.x === me.x && c.y === me.y))) {
      drawChara(ctx, ch, cs, scale, imgs, animFrame, dx * scale, input.eagleEye ? 0 : CHARA_Y_ABOVE_FLOOR * scale);
    }
    ctx.restore();
    return;
  }
  if (input.split?.part !== 'front') {
    ctx.clearRect(0, 0, view.w * cs, view.h * cs);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, view.w * cs, view.h * cs);
  }

  const chipImg = imgs.chip;
  // マスのチップシート(Philly の DefineNo = Attribute & 0x03)
  // 4枚は描く前に一度だけ引く。マスごとに引くと、そのたびに URL を作る(#75)
  const chips = [0, 1, 2, 3].map((d) => (imgs.chipOf ? imgs.chipOf(d) : chipImg) ?? null);
  const chipFor = (cell: MapCell) => chips[cell.attr & 0x03];
  const half = cs / 2; // 16(等倍) / 32(拡大)
  // 水有無グリッド(水縁エフェクト用)。チップ画像があれば1回構築。
  const water = chipImg ? buildWaterGrid(input.cells, width, height) : null;

  const me = input.self ?? { x: (width - 1) >> 1, y: (height - 1) >> 1 };
  const unknownStyle = input.unknown ?? 'black';
  const kinds = unknownStyle === 'black' ? null : unknownKinds(input.cells, width, height);
  // 1 は霧、2 は屋根(roof の時だけ。fog では霧)
  const kindAt = (c: number, r: number) =>
    !kinds || c < 0 || r < 0 || c >= width || r >= height ? 0 : unknownStyle === 'fog' && kinds[r * width + c] ? 1 : kinds[r * width + c];
  const slide = input.slide && (input.slide.x || input.slide.y) ? input.slide : null;
  const atCenter = (c: MapChar) => c.x === me.x && c.y === me.y;
  const range = drawRange(view, slide ?? { x: 0, y: 0 }, width, height, cs);
  const { c0, c1 } = range;
  // 分けて描く時は、その分の行だけ
  const split = input.split;
  const r0 = split?.part === 'front' ? Math.max(range.r0, split.row) : range.r0;
  const r1 = split?.part === 'back' ? Math.min(range.r1, split.row - 1) : range.r1;
  const inRange = (c: MapChar) => c.x >= c0 && c.x <= c1 && c.y >= r0 && c.y <= r1;
  ctx.save();
  ctx.translate(-view.x * cs, -view.y * cs);
  ctx.save();
  if (slide) ctx.translate(slide.x, slide.y);

  // 行ごとに チップ → 水縁 → 看板 → アイテム → キャラ の順で重ね描画。
  for (let row = r0; row <= r1; row++) {
    // 1. ベースチップ
    if (chipImg) {
      for (let col = c0; col <= c1; col++) {
        const cell = input.cells[cellIndex(col, row, width)];
        const img = cell && chipFor(cell);
        if (!cell || !img) continue;
        const k = kindAt(col, row);
        if (k === 1 && unknownStyle === 'fog') {
          drawFog(ctx, col, row, cs);
          continue;
        }
        if (k === 2) {
          // 屋根は全部の行を描いた後に上から乗せる。ここは屋根の下になる
          drawFog(ctx, col, row, cs);
          continue;
        }
        // 地面を先に1行分描き、重ねるチップ(木)は後で描く。木を横にずらした時に、右隣の地面で消えないように
        drawChip(ctx, img, chipIndices(cell.chip)[0], col, row, cs, scale);
        if (input.origin && cell.chip === GRASS_BYTE)
          drawGrassJitter(ctx, cellHash(input.origin.x + col, input.origin.y + row), col, row, cs, scale);
      }
      for (let col = c0; col <= c1; col++) {
        const cell = input.cells[cellIndex(col, row, width)];
        const img = cell && chipFor(cell);
        if (!cell || !img) continue;
        if (unknownStyle === 'fog' && !kindAt(col, row)) {
          // 霧に接する辺はぼかす
          [kindAt(col, row - 1), kindAt(col + 1, row), kindAt(col, row + 1), kindAt(col - 1, row)].forEach((k, side) => {
            if (k === 1) drawFogEdge(ctx, col, row, side, cs, scale);
          });
        }
        for (const idx of chipIndices(cell.chip).slice(1)) {
          if (idx !== TREE_CHIP || !input.origin) {
            drawChip(ctx, img, idx, col, row, cs, scale);
            continue;
          }
          const t = treeJitter(cellHash(input.origin.x + col, input.origin.y + row));
          ctx.save();
          ctx.translate(t.dx * scale, t.dy * scale);
          drawChip(ctx, img, idx, col, row, cs, scale);
          ctx.restore();
        }
      }
    }

    // 1.5 水縁overlay(隣接チップに応じた四分割境界描画)
    if (chipImg && water) {
      for (let col = c0; col <= c1; col++) {
        const cell = input.cells[cellIndex(col, row, width)];
        const img = cell && chipFor(cell);
        if (!cell || !img || cell.chip !== WATER_BYTE) continue;
        // water配列はgrid座標(row,col)を左上に [row..row+2][col..col+2] 参照。
        const patterns = waterQuarterPatterns(water, row, col);
        const cellX = col * cs;
        const cellY = row * cs;
        for (let q = 0; q < 4; q++) {
          const hit = waterQuarterChip(q, patterns[q]);
          if (!hit) continue;
          const sr = chipQuarterSrcRect(hit.chipIndex, hit.srcQuarter);
          if (!sr) continue;
          const dstX = cellX + (q & 1) * half;
          const dstY = cellY + ((q >> 1) & 1) * half;
          ctx.drawImage(img, sr.sx, sr.sy, sr.sw, sr.sh, dstX, dstY, half, half);
        }
      }
    }

    // 2. 看板overlay(attribute bit 0x08)。看板チップは段差ありのため stretch 描画。
    if (chipImg) {
      for (let col = c0; col <= c1; col++) {
        const cell = input.cells[cellIndex(col, row, width)];
        const img = cell && hasBoard(cell.attr) && chipFor(cell);
        if (img) drawChip(ctx, img, boardChipIndex(cell!.chip), col, row, cs, scale, 'stretch');
      }
    }

    // 3. アイテムoverlay(attribute bits 0x70)
    if (input.eagleEye && chipImg) {
      for (let col = c0; col <= c1; col++) {
        const cell = input.cells[cellIndex(col, row, width)];
        const img = cell && hasItem(cell.attr) && chipFor(cell);
        if (img) drawChip(ctx, img, EAGLE_EYE_ITEM_CHIP, col, row, cs, scale, 'stretch');
      }
    } else if (imgs.items) {
      for (let col = c0; col <= c1; col++) {
        const cell = input.cells[cellIndex(col, row, width)];
        if (!cell || !hasItem(cell.attr)) continue;
        // 防御円('x'/'%')上は上11pxクリップで円内に収める(itemDrawRect)。scale で拡大。
        const r = itemDrawRect(itemNo(cell.attr), cell.chip, col * cs, row * cs, scale);
        ctx.drawImage(
          imgs.items,
          r.sx, r.sy, r.sw, r.sh,
          r.dx, r.dy, r.dw, r.dh,
        );
      }
    }

    // 4. キャラ(この行)。同じマスに2人いれば横にずらす(arrangeRow)
    const rowChars = input.chars.filter((c) => c.y === row && inRange(c) && !((slide || input.only === 'others') && atCenter(c)));
    for (const { ch, dx } of arrangeRow(rowChars)) {
      drawChara(ctx, ch, cs, scale, imgs, animFrame, dx * scale, input.eagleEye ? 0 : CHARA_Y_ABOVE_FLOOR * scale);
    }
  }

  // 4.5 屋根。壁の高さ(上へはみ出す 16px)だけ持ち上げ、壁の上に乗せる。軒の下には影を落とす
  if (kinds && unknownStyle === 'roof') {
    const roof = roofCells(kinds, width, height);
    const on = (c: number, r: number) => c >= 0 && r >= 0 && c < width && r < height && roof[r * width + c] === 1;
    const lift = CHIP_HEIGHT_ABOVE * scale;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (!on(col, row)) continue;
        if (!on(col, row + 1)) {
          // 軒の影。屋根の下の壁に落とす
          const y = (row + 1) * cs - lift;
          const g = ctx.createLinearGradient(0, y, 0, y + 10 * scale);
          g.addColorStop(0, 'rgba(0,0,0,0.5)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(col * cs, y, cs, 10 * scale);
        }
        ctx.save();
        ctx.translate(0, -lift);
        drawRoof(ctx, col, row, cs, scale, !on(col, row - 1), !on(col, row + 1));
        ctx.restore();
      }
    }
  }

  // 5. キャラ名ラベル(自キャラは除外)。分けて描く時は、前の分に全部描く(地形より上に出す)
  if (split?.part !== 'back') {
    const shown = (c: MapChar) => c.x >= c0 && c.x <= c1 && c.y >= range.r0 && c.y <= range.r1;
    drawCharaNames(ctx, input.chars.filter((c) => !atCenter(c) && shown(c)), cs, scale, width, height);
  }
  ctx.restore();

  // ずらしている間は、自キャラを最後にずらさずに描く
  if (slide) {
    for (const { ch, dx } of arrangeRow(input.chars.filter(atCenter))) {
      drawChara(ctx, ch, cs, scale, imgs, animFrame, dx * scale, input.eagleEye ? 0 : CHARA_Y_ABOVE_FLOOR * scale);
    }
  }
  ctx.restore();
}

/**
 * 1チップを1セルへ描画。scale=2(拡大)時は合成クラスで埋め方を分岐。
 *   stretch: src 32×48 → cs × (CHIP_HEIGHT*scale)、上(16*scale)px はみ出し(段差)。
 *   tile   : 本体 32×32 を 2×2 タイル敷き(等倍くっきり)。
 *   center : 本体 32×32 を本体中央へ1枚。
 * scale=1 は常に stretch(=現行の等倍描画)で挙動不変。
 * @param klassOverride 看板等で明示クラス指定する場合に使う。
 */
function drawChip(
  ctx: CanvasRenderingContext2D,
  chipImg: HTMLImageElement,
  index: number,
  col: number,
  row: number,
  cs: number,
  scale: number,
  klassOverride?: 'tile' | 'stretch' | 'center',
): void {
  const r = chipSrcRect(index);
  if (!r) return; // 未知index → 描画スキップ(index0誤描画を避ける)
  const klass = scale === 2 ? (klassOverride ?? chipClass(index)) : 'stretch';
  const cellX = col * cs;
  const cellTop = row * cs;

  if (klass === 'stretch') {
    const overhang = (CHIP_HEIGHT - CHIP_SIZE) * scale; // 16*scale
    ctx.drawImage(chipImg, r.sx, r.sy, r.sw, r.sh, cellX, cellTop - overhang, cs, CHIP_HEIGHT * scale);
    return;
  }

  // tile / center: 本体 32×32 = src の下32px(上16px=オーバーハングを除く)。
  const bodySx = r.sx;
  const bodySy = r.sy + (CHIP_HEIGHT - CHIP_SIZE); // +16
  const body = CHIP_SIZE; // 32

  if (klass === 'tile') {
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        ctx.drawImage(
          chipImg, bodySx, bodySy, body, body,
          cellX + tx * half32(cs), cellTop + ty * half32(cs), half32(cs), half32(cs),
        );
      }
    }
    return;
  }
  // center
  const off = (cs - CHIP_SIZE) / 2;
  ctx.drawImage(chipImg, bodySx, bodySy, body, body, cellX + off, cellTop + off, CHIP_SIZE, CHIP_SIZE);
}

/** タイル1枚の1辺(セルの半分)。 */
function half32(cs: number): number {
  return cs / 2;
}

/** 1キャラを描画(スプライト or placeholder)。 */
function drawChara(
  ctx: CanvasRenderingContext2D,
  ch: MapChar,
  cs: number,
  scale: number,
  imgs: ImageRefs,
  animFrame: number,
  dx = 0,
  raise = 0,
): void {
  const img = imgs.chara(charaUrl(ch));
  if (!img) {
    // 未ロード: 頭文字を暫定描画。
    ctx.save();
    ctx.fillStyle = '#ff0';
    ctx.font = `bold ${14 * scale}px "Noto Sans JP", "Noto Sans CJK JP", "Segoe UI", "BIZ UDPGothic", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(nameInitial(ch.name), ch.x * cs + cs / 2 + dx, ch.y * cs + cs / 2);
    ctx.restore();
    return;
  }
  // 拡大表示(scale=2)は通常キャラも右側32×32フレームを使い等倍中央配置。
  const r = charaSrcRect(ch.dir, ch.gigant, animFrame, scale === 2);
  const baseX = ch.x * cs + Math.floor((cs - r.sw) / 2) + dx;
  const baseY = ch.y * cs + Math.floor((cs - CHARA_H) / 2) - raise;

  // 巨大キャラ magnify(#ex-obj): 描画原点補正 + 拡大サイズ。scale で拡大。
  if (ch.magnify) {
    const m = scale === 1
      ? ch.magnify
      : { w: ch.magnify.w * scale, h: ch.magnify.h * scale, z: ch.magnify.z * scale };
    const d = magnifiedDst(baseX, baseY, m);
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, d.dx, d.dy, d.dw, d.dh);
    return;
  }

  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, baseX, baseY, r.sw, r.sh);
}

/** キャラ名ラベル描画((x,y)重複は後勝ち)。 */
function drawCharaNames(
  ctx: CanvasRenderingContext2D,
  chars: MapChar[],
  cs: number,
  scale: number,
  width: number,
  height: number,
): void {
  const perCell = new Map<string, { x: number; y: number; name: string }>();
  for (const c of chars) {
    if (c.x < 0 || c.x >= width || c.y < 0 || c.y >= height) continue;
    const name = c.name.replace(/\/\*.*?\*\//g, '').trim();
    if (!name) continue;
    perCell.set(`${c.x},${c.y}`, { x: c.x, y: c.y, name });
  }
  if (perCell.size === 0) return;

  ctx.save();
  ctx.font = `bold ${9 * scale}px "Noto Sans JP", "Noto Sans CJK JP", "Segoe UI", "BIZ UDPGothic", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const { x, y, name } of perCell.values()) {
    const tx = x * cs + cs / 2;
    const ty = y * cs + cs * 0.6;
    ctx.fillStyle = '#000';
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      ctx.fillText(name, tx + dx, ty + dy);
    }
    ctx.fillStyle = '#fff';
    ctx.fillText(name, tx, ty);
  }
  ctx.restore();
}
