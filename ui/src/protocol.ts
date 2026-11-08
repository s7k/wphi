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
  /** 7 か 5 */
  size: number;
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
  | { type: "worldTransfer" };

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
  /** 前に送った後に変わった拡張マップのマス。MapState と同じ送信で送り、map 窓が1回で描く(#75) */
  diffs?: { world: string; diff: Record<string, MapCell> }[];
  /** 実験的: 最後に届いた地図の位置から、main 窓が予想したずれ(ui/src/predict.ts) */
  predict?: { dx: number; dy: number };
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
