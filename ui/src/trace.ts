// 時刻の記録(#44、src-tauri/src/trace.rs)。ツールのメニューで始めた間だけ、出来事を Rust へ送ってファイルに書く
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

let on = false;
invoke<boolean>("trace_on")
  .then((v) => (on = v))
  .catch(() => {});
listen<boolean>("phi-trace", (e) => (on = e.payload)).catch(() => {});

export function trace(what: string) {
  if (on) invoke("trace", { at: performance.timeOrigin + performance.now(), what }).catch(() => {});
}
