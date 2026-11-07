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

export type NoticeEvent = { type: "notice"; name?: string; mapset?: string; world?: string; area?: string };

export type ModeEvent = { type: "mode"; attack: boolean; magic: boolean; list: boolean; more: boolean };

export type UiEvent =
  | { type: "log"; channel: string; html: string; from?: string }
  | { type: "error"; message: string }
  | { type: "connection"; state: "closed" }
  /** 世界移動が済んだ */
  | { type: "worldMoved"; host: string; port: number }
  | MapEvent
  | StatusEvent
  | CondEvent
  | NoticeEvent
  | ModeEvent
  | ListEvent
  | { type: "edit"; mode: "single" | "multi" | "end" }
  | { type: "userList" | "eagleEye" | "worldTransfer" };

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
  /** 表示中のリストの行(マップ窓の右の領域にも出す。Philly.ini の ListInMap) */
  list?: string[];
};

/** Tauri のイベント名(main → map) */
export const MAP_STATE_EVENT = "phi-map-state";
