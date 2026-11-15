// EagleEye の盤面(Philly の EagleEye.cpp の classEagleEye::Draw)。
import type { EagleEyeEvent, MapCell, MapChar } from "./protocol";

const UNKNOWN = "?".charCodeAt(0);

/** 人がいるマスの属性(EagleEye.cpp) */
const PERSON = 0x58;
/**
 * 人のマスに描くキャラグラ。Philly はスキンの既定グラ「人・銅像」を描くが、
 * WPHI は t_man にする(2026-11-07 に作者が指定)。無ければ種別 0x40 の解決で既定グラに戻る
 */
const PERSON_GRA = "t_man";

/**
 * EagleEye のマスを盤面にする。幅と高さはサーバが送った通り(v6 の接続は 65x29 で正方形でない)。
 * 人のマスは属性を消して、既定グラの人を置く
 */
export function eagleBoard(ev: EagleEyeEvent): { cells: MapCell[]; chars: MapChar[] } {
  const { width, height } = ev;
  // 届かなかったマスは「不明な場所」のチップ(?)で埋める
  const cells: MapCell[] = Array.from({ length: width * height }, () => ({ chip: UNKNOWN, attr: 0 }));
  const chars: MapChar[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = ev.cells[y * width + x];
      if (!c) continue;
      if (c.attr === PERSON) {
        cells[y * width + x] = { chip: c.chip, attr: 0 };
        // 巨大・正面で描く(Philly の DrawEagleEye)。種別 0x40 はグラ名を先に探す
        chars.push({ id: 0, x, y, dir: "F", name: "", gra: PERSON_GRA, status: 0, gigant: "*", layer: 0, default: 0x40 });
      } else cells[y * width + x] = c;
    }
  }
  return { cells, chars };
}

