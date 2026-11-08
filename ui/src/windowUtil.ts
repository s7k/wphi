// 副窓(map・eagleeye)で共通に使うもの。
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useRef } from "react";

/** 閉じるボタンで窓を破棄せずに隠す。破棄すると main 窓から送る先が無くなる */
export function hideOnClose(onHide?: () => void) {
  const w = getCurrentWindow();
  w.onCloseRequested((e) => {
    e.preventDefault();
    w.hide().catch(console.error);
    onHide?.();
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

/**
 * WebView の標準の動きを止める。どの窓でも最初に呼ぶ。
 * - 右クリックの標準のメニュー(macOS の Look Up・Translate、Reload など)。Reload でページを読み込み直すと、
 *   main 窓は接続し直して二重に接続する(既にアクセスされています)。入力欄だけは、コピーと貼り付けの為に残す
 * - F5・Ctrl+R・Cmd+R の読み込み直し。Shift+F5(マップ)などの操作には回す
 */
export function preventBrowserDefaults() {
  document.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable]")) return;
    e.preventDefault();
  });
  window.addEventListener(
    "keydown",
    (e) => {
      const reload = (e.code === "F5" && !e.shiftKey && !e.altKey) || (e.code === "KeyR" && (e.ctrlKey || e.metaKey));
      if (reload) e.preventDefault();
    },
    true,
  );
}
