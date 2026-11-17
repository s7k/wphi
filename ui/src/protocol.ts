// crates/phi-proto/src/parser.rs の Event と、src-tauri/src/session.rs の UiEvent の型。

export type MapCell = { chip: number; attr: number };

export type Magnify = { w: number; h: number; z: number };

export type MapChar = {
  id: number;
  x: number;
  y: number;
  /** B R F L */
  dir: string;
  name: string;
  gra: string;
  status: number;
  /** "#" は通常、"*" は巨大 */
  gigant: string;
  layer: number;
  /** 種別。キャラグラが無い時の既定グラを決める */
  default: number;
  magnify?: Magnify;
};

export type MapEvent = {
  type: "map";
  /** 幅と高さ。#m57 は 7、#v6 はサーバが返した大きさ */
  width: number;
  height: number;
  /** #v6 で届いた地図(docs/05-protocol-v6.md) */
  v6?: boolean;
  dir: number;
  cells: MapCell[];
  chars: MapChar[];
  style?: string;
  pos?: { x: number; y: number };
};

export type StatusEvent = {
  type: "status";
  name?: string;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  exp?: number;
  gp?: number;
  f?: number;
  w?: number;
  m?: number;
  c?: number;
};

export type CondEvent = {
  type: "cond";
  poison: boolean;
  palsy: boolean;
  panic: boolean;
  confuse: boolean;
  berserk: boolean;
  silence: boolean;
  blind: boolean;
};

export type NoticeEvent = {
  type: "notice";
  name?: string;
  mapset?: string;
  world?: string;
  area?: string;
  /** [番号, マップセット](#mapset-define) */
  mapsetDefine?: [number, string];
};

export type ModeEvent = { type: "mode"; attack: boolean; magic: boolean; list: boolean; more: boolean };

export type UiEvent =
  | { type: "log"; channel: string; html: string; from?: string; noFlash?: boolean; raw?: string }
  | { type: "error"; message: string }
  | { type: "connection"; state: "closed" }
  /** 効果音。file が false ならタスクバーの点滅 */
  | { type: "sound"; no: number; file: boolean }
  /** 世界移動が済んだ */
  | { type: "worldMoved"; host: string; port: number }
  /** 今と違うホストへの世界移動を確かめる。TRANSFER_YES か TRANSFER_NO を送る(#51) */
  | { type: "confirmTransfer"; host: string; port: number }
  | MapEvent
  | StatusEvent
  | CondEvent
  | NoticeEvent
  | ModeEvent
  | ListEvent
  | { type: "edit"; mode: "single" | "multi" | "end" }
  | { type: "userList"; users: { key: string; name: string }[] }
  | EagleEyeEvent
  | { type: "worldTransfer" }
  /** #v6 G。v6 のサーバが go のたびに地図より先に送る、動いた差。進めなかった時は 0 0 */
  | { type: "moved"; dx: number; dy: number }
  /** #v6 I。手持ちの 8 個(空きは null) */
  | { type: "items"; items: (ItemInfo | null)[] }
  /** #ex-inv。インベントリ(預かり所)の中身。名前の順で、取り出す番号は 1 から */
  | { type: "bag"; items: ItemInfo[] }
  /** #ex-inv no。出し入れ出来なかった理由 */
  | { type: "bagRefused"; reason: string };

/** 持ち物 1 個(phi_dm の docs/dev/protocol-v6.md の「持ち物とインベントリ」) */
export type ItemInfo = {
  /** 装備の印。W 武器、A 防具、O その他、- 無し */
  eq: string;
  /** 用途(IT_*)、武器の種類(WT_*)、材質(MT_*)、属性(FN_*)の番号 */
  it: number;
  wt: number;
  mt: number;
  fn: number;
  wp: number;
  op: [number, number, number, number];
  /** チャージアイテムの残りの回数 */
  count?: number;
  /** 使えるまでの秒数(届いた時点) */
  ready: number;
  /** 世界の名前の表の名前 */
  type: string;
  wtype: string;
  mat: string;
  elem: string;
  name: string;
};

export type EagleEyeEvent = {
  type: "eagleEye";
  width: number;
  height: number;
  self: { x: number; y: number };
  /** width * height 個を行優先で */
  cells: MapCell[];
  mapset?: string;
};

/** #list で active、#end-list で行が届く。閉じる時は active: false */
export type ListEvent = { type: "list"; active: boolean; lines?: string[] };

/** main 窓が map 窓へ送る、アクティブなタブの状態。 */
export type MapState = {
  session: number;
  mapset: string;
  world?: string;
  area?: string;
  map?: MapEvent;
  status?: StatusEvent;
  cond?: CondEvent;
  mode?: ModeEvent;
  /** #mapset-define の番号 1〜3 → マップセット(Philly の MapChipDefine。0 は mapset) */
  defines?: string[];
  /** 表示中のリストの行(マップ窓の右の領域にも出す。Philly.ini の ListInMap) */
  list?: string[];
  /** リストのチェック(main 窓のリストと同じ) */
  listChecked?: boolean[];
  /** 実験的: 最後に届いた地図の位置から、main 窓が予想したずれ(ui/src/predict.ts) */
  predict?: { dx: number; dy: number };
  /**
   * #v6 G を送るサーバで、自キャラが歩いた分を足した位置(ui/src/predict.ts の walk)。原点は決めず、差だけに使う。
   * epoch が変わったら(タブの切り替え・テレポート)前の位置とは比べない。at は位置が変わった時刻
   * (performance.timeOrigin + performance.now() の ms。窓をまたいで比べる)。スムーズ移動が使う
   */
  walk?: { x: number; y: number; epoch: number; at: number; ms: number; bump?: { dx: number; dy: number; at: number } };
};

/**
 * map 窓のリストの操作(Philly の MapForm.cpp ListBoxMouseUp)。map 窓 → main 窓。
 * pick はその行を選んで送る、toggle はその行のチェックを切り替える、send はチェックした行を送る
 */
export const MAP_LIST_EVENT = "phi-map-list";
export type MapListAction = { type: "pick"; index: number } | { type: "toggle"; index: number } | { type: "send" };

/** 世界移動の確かめへの答え(src-tauri/src/session.rs)。サーバへは送らない */
export const TRANSFER_YES = "#wphi-transfer yes";
export const TRANSFER_NO = "#wphi-transfer no";

/** Tauri のイベント名(main → map) */
export const MAP_STATE_EVENT = "phi-map-state";
/** Tauri のイベント名(map → main)。閉じるボタンで隠した時 */
export const MAP_HIDDEN_EVENT = "phi-map-hidden";
/** Tauri のイベント名(main → eagleeye) */
export const EAGLE_EYE_EVENT = "phi-eagleeye";
