// EagleEye の盤面(Philly の EagleEye.cpp の classEagleEye::Draw)。
import type { EagleEyeEvent, MapCell, MapChar } from "./protocol";

const UNKNOWN = "?".charCodeAt(0);

/** 人がいるマスの属性(EagleEye.cpp) */
const PERSON = 0x58;

/** EagleEye のマスを正方形の盤面にする。人のマスは属性を消して、既定グラの人を置く */
export function eagleBoard(ev: EagleEyeEvent): { dim: number; cells: MapCell[]; chars: MapChar[] } {
  const dim = Math.max(ev.width, ev.height, 1);
  // 盤面の外は「不明な場所」のチップ(? = 31)で埋める
  const cells: MapCell[] = Array.from({ length: dim * dim }, () => ({ chip: UNKNOWN, attr: 0 }));
  const chars: MapChar[] = [];
  for (let y = 0; y < ev.height; y++) {
    for (let x = 0; x < ev.width; x++) {
      const c = ev.cells[y * ev.width + x];
      if (!c) continue;
      if (c.attr === PERSON) {
        cells[y * dim + x] = { chip: c.chip, attr: 0 };
        // Philly は CharaGraBitBltList の 0 番(スキンの既定グラ「人・銅像」)を巨大・正面で描く
        chars.push({ id: 0, x, y, dir: "F", name: "", gra: "", status: 0, gigant: "*", layer: 0, default: 0 });
      } else cells[y * dim + x] = c;
    }
  }
  return { dim, cells, chars };
}

