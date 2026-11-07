// マップ窓の下のステータス表示(Philly の CharacterCommon.cpp classStatus の DrawStatusFrame と DrawStatusContents)。
// 寸法は CharacterCommon.h の HpMpMargin* と FWMCGpMarginLeft。
import type { CondEvent, StatusEvent } from "./protocol";

export const STATUS_HEIGHT = 50;
const MARGIN_LEFT = 20;
const MARGIN_RIGHT = 105;
const HP_TOP = 8;
const MP_TOP = 31;
const BAR_THICKNESS = 15;
const FWMC_MARGIN_LEFT = 100;

/** Windows の既定色(Philly.ini の BaseColor など) */
const BTN_FACE = "#d4d0c8";
const WINDOW = "#ffffff";
const WINDOW_TEXT = "#000000";

export type StatusImages = {
  /** HpMpPanel.bmp(20×50、teal 透過) */
  panel?: HTMLImageElement;
  /** Status.bmp(100×50 が2枚、teal 透過)。左の1枚を使う */
  status?: HTMLImageElement;
  /** HpMpBar.bmp(100×15 が 4列×2行、y は 0 と 16。透過なし) */
  bar?: HTMLImageElement;
};

/** Windows の凹んだ枠(CanvasUtil の DrawFrameShadow) */
function frameShadow(ctx: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number) {
  const line = (color: string, pts: [number, number][]) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + 0.5, y + 0.5) : ctx.moveTo(x + 0.5, y + 0.5)));
    ctx.stroke();
  };
  line("#808080", [[left, bottom - 1], [left, top], [right - 1, top]]);
  line("#000000", [[left + 1, bottom - 2], [left + 1, top + 1], [right - 2, top + 1]]);
  line("#ffffff", [[left, bottom - 1], [right - 1, bottom - 1], [right - 1, top - 1]]);
  line("#c0c0c0", [[left + 1, bottom - 2], [right - 2, bottom - 2], [right - 2, top]]);
}

/** HP/MP バーの一部(HpMpBarPartWrite)。no は 0=HP、1=HP の減った分、2=空き、3=毒の HP、4〜7 は MP の同じ並び */
function barPart(ctx: CanvasRenderingContext2D, bar: HTMLImageElement, left: number, top: number, width: number, no: number) {
  const sx = (no % 4) * 100;
  const sy = Math.floor(no / 4) * 16;
  for (; width >= 100; width -= 100, left += 100) ctx.drawImage(bar, sx, sy, 100, BAR_THICKNESS, left, top, 100, BAR_THICKNESS);
  if (width > 0) ctx.drawImage(bar, sx, sy, width, BAR_THICKNESS, left, top, width, BAR_THICKNESS);
}

/** 縁付きの文字(TextRectEdge)。中央に置く */
function edgeText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#808080";
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) ctx.fillText(text, cx + dx, cy + dy);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, cx, cy);
}

/** HP か MP のバー(DrawStatusContents)。減った時は前回の値までを別の色で塗る */
function hpMpBar(
  ctx: CanvasRenderingContext2D,
  bar: HTMLImageElement,
  top: number,
  width: number,
  now: number,
  old: number,
  max: number,
  nos: [number, number, number],
) {
  if (max === 0) return;
  const ratio = width / max;
  let left = MARGIN_LEFT;
  let w = Math.floor(now * ratio + 0.5);
  barPart(ctx, bar, left, top, w, nos[0]);
  left += w;
  if (now < old) {
    w = Math.floor((Math.min(old, max) - now) * ratio + 0.5);
    barPart(ctx, bar, left, top, w, nos[1]);
    left += w;
  }
  barPart(ctx, bar, left, top, width - left + MARGIN_LEFT, nos[2]);
}

export function drawStatus(
  ctx: CanvasRenderingContext2D,
  width: number,
  imgs: StatusImages,
  now: StatusEvent | undefined,
  old: StatusEvent | undefined,
  cond: CondEvent | undefined,
) {
  ctx.fillStyle = BTN_FACE;
  ctx.fillRect(0, 0, width, STATUS_HEIGHT);
  frameShadow(ctx, MARGIN_LEFT - 2, HP_TOP - 2, width - MARGIN_RIGHT + 2, HP_TOP + BAR_THICKNESS + 2);
  frameShadow(ctx, MARGIN_LEFT - 2, MP_TOP - 2, width - MARGIN_RIGHT + 2, MP_TOP + BAR_THICKNESS + 2);
  if (imgs.panel) ctx.drawImage(imgs.panel, 0, 0);
  if (imgs.status) ctx.drawImage(imgs.status, 0, 0, 100, STATUS_HEIGHT, width - 100, 0, 100, STATUS_HEIGHT);

  // F・W・M・C と GP の欄(右寄せ)
  const base = width - FWMC_MARGIN_LEFT;
  const cells: [number, number, number | undefined][] = [
    [20, 2, now?.f],
    [70, 2, now?.w],
    [20, 19, now?.m],
    [70, 19, now?.c],
    [70, 36, now?.gp],
  ];
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  for (const [x, y, v] of cells) {
    ctx.fillStyle = WINDOW;
    ctx.fillRect(base + x, y, 28, 12);
    if (v === undefined) continue;
    ctx.fillStyle = WINDOW_TEXT;
    ctx.fillText(String(v), base + x + 28, y + 1, 28);
  }

  if (!now || now.maxHp === undefined || !imgs.bar) return;
  const barWidth = width - MARGIN_LEFT - MARGIN_RIGHT;
  const hp = now.hp ?? 0;
  const mp = now.mp ?? 0;
  hpMpBar(ctx, imgs.bar, HP_TOP, barWidth, hp, old?.hp ?? hp, now.maxHp, [cond?.poison ? 3 : 0, 1, 2]);
  hpMpBar(ctx, imgs.bar, MP_TOP, barWidth, mp, old?.mp ?? mp, now.maxMp ?? 0, [cond?.panic ? 7 : 4, 5, 6]);
  ctx.font = "bold 13px sans-serif";
  const cx = MARGIN_LEFT + barWidth / 2;
  edgeText(ctx, `${hp}/${now.maxHp}`, cx, HP_TOP + BAR_THICKNESS / 2);
  edgeText(ctx, `${mp}/${now.maxMp ?? 0}`, cx, MP_TOP + BAR_THICKNESS / 2);
}
