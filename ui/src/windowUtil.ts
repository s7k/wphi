// 副窓(map・eagleeye)で共通に使うもの。
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useRef } from "react";

/** 閉じるボタンで窓を破棄せずに隠す。破棄すると main 窓から送る先が無くなる */
export function hideOnClose() {
  const w = getCurrentWindow();
  w.onCloseRequested((e) => {
    e.preventDefault();
    w.hide().catch(console.error);
  }).catch(console.error);
}

/** URL → 画像。読み込みが終わったら onLoad を呼ぶ。未ロードは undefined、読めなかった時は null */
export function useImages(onLoad: () => void) {
  const cache = useRef(new Map<string, HTMLImageElement | null>());
  return (url: string): HTMLImageElement | null | undefined => {
    const c = cache.current;
    if (c.has(url)) {
      const img = c.get(url)!;
      return img && img.complete ? img : img === null ? null : undefined;
    }
    const img = new Image();
    img.onload = onLoad;
    img.onerror = () => c.set(url, null);
    img.src = url;
    c.set(url, img);
    return undefined;
  };
}
