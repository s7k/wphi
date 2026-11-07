import type { MapChar } from "./protocol";

// src-tauri/src/assets.rs の phi-asset スキーム。Windows(WebView2)では http://<スキーム>.localhost になる
const BASE = navigator.userAgent.includes("Windows") ? "http://phi-asset.localhost" : "phi-asset://localhost";

export function assetUrl(kind: "chara" | "chip" | "items" | "skin", params: Record<string, string> = {}): string {
  return `${BASE}/${kind}?${new URLSearchParams(params)}`;
}

export function charaUrl(ch: MapChar): string {
  return assetUrl("chara", { name: ch.name, gra: ch.gra, code: String(ch.default) });
}

/** スキンの Images の画像。透過色は Philly の ImageStore.cpp と同じものを渡す */
export function skinUrl(file: string, key: "teal" | "white" | "none"): string {
  return assetUrl("skin", { file, key });
}
