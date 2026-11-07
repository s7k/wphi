// マップ上のマウスの位置から移動の向きを決める(Philly の MapForm.cpp の FormMouseMove)。
import type { MoveKey } from "./keys.ts";

export type MouseDir = {
  /** 押した時に押したことにするキー(Philly の GetMoveKey のマウスの分) */
  keys: MoveKey[];
  /** その向きを示すカーソル(Philly はスキンの Cursor/*.cur を使う) */
  cursor: string;
};

const PI_8 = Math.PI / 8;

/**
 * マップの左上を原点にした (x, y) から向きを決める。マップの中心と外は null。
 * 回転マップでは、上の 50px の左右の端と、Shift か Ctrl を押している間の左右の半分が回転になる。
 */
export function mouseDir(x: number, y: number, w: number, h: number, northFix: boolean, shiftOrCtrl: boolean): MouseDir | null {
  if (x < 0 || x > w || y < 0 || y > h) return null;
  const dx = x - w / 2;
  const dy = y - h / 2;
  if (dx === 0 && dy === 0) return null;
  const turnLeft: MouseDir = { keys: ["7"], cursor: "w-resize" };
  const turnRight: MouseDir = { keys: ["9"], cursor: "e-resize" };
  if (!northFix && shiftOrCtrl) return x < w / 2 ? turnLeft : turnRight;
  if (!northFix && y < 50) {
    if (x < 50) return turnLeft;
    if (x > w - 50) return turnRight;
  }
  const t = Math.atan2(dy, dx);
  if (t < -7 * PI_8) return { keys: ["4"], cursor: "w-resize" };
  if (t < -5 * PI_8) return { keys: ["8", "4"], cursor: "nw-resize" };
  if (t < -3 * PI_8) return { keys: ["8"], cursor: "n-resize" };
  if (t < -1 * PI_8) return { keys: ["8", "6"], cursor: "ne-resize" };
  if (t < 1 * PI_8) return { keys: ["6"], cursor: "e-resize" };
  if (t < 3 * PI_8) return { keys: ["2", "6"], cursor: "se-resize" };
  if (t < 5 * PI_8) return { keys: ["2"], cursor: "s-resize" };
  if (t < 7 * PI_8) return { keys: ["2", "4"], cursor: "sw-resize" };
  return { keys: ["4"], cursor: "w-resize" };
}
