// 地図より先に届いたマップセット (#ex-notice の mapset と mapset-define) を、次の地図まで貯める。
// 地図の状態へすぐ入れると、地図より先に届く #v6 G などで地図の窓へ送り、古い地図を新しいマップセットで描いて
// 一瞬違う絵になる (区域の境を越えた時に道の絵が変わった)

/** 貯めているマップセット。mapset は使うマップセットの名前、defines は番号ごとの定義 */
export type PendingMapset = { mapset?: string; defines?: string[] };

/** マップセットの知らせを貯める。defines は前に貯めた分か、今の地図の分に重ねる */
export function holdMapset(
  pending: PendingMapset | undefined,
  ev: { mapset?: string; mapsetDefine?: [number, string] },
  current: string[] | undefined,
): PendingMapset {
  const p = { ...pending };
  if (ev.mapset !== undefined) p.mapset = ev.mapset;
  else if (ev.mapsetDefine) {
    const defines = [...(p.defines ?? current ?? [])];
    defines[ev.mapsetDefine[0]] = ev.mapsetDefine[1];
    p.defines = defines;
  }
  return p;
}

/** 地図が届いた時に、貯めた分を地図の状態へ入れる */
export function applyMapset(state: { mapset?: string; defines?: string[] }, pending: PendingMapset | undefined): void {
  if (pending?.mapset !== undefined) state.mapset = pending.mapset;
  if (pending?.defines) state.defines = pending.defines;
}
