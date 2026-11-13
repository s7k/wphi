// 副窓(map・eagleeye)で共通に使うもの。
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useRef, type RefObject } from "react";

/** 閉じるボタンで窓を破棄せずに隠す。破棄すると main 窓から送る先が無くなる */
export function hideOnClose(onHide?: () => void) {
  const w = getCurrentWindow();
  w.onCloseRequested((e) => {
    e.preventDefault();
    w.hide().catch(console.error);
    onHide?.();
  }).catch(console.error);
}

/** URL → 画像。読み込みが終わったら onLoad を呼ぶ。未ロードは undefined、読めなかった時は null。
 * グラキャッシュ初期化(phi-assets-reload。#82)で覚えた画像を捨て、URL を変えて読み直す(WebView の覚えた分を使わない為) */
export function useImages(onLoad: () => void) {
  const cache = useRef(new Map<string, HTMLImageElement | null>());
  const generation = useRef(0);
  useEffect(() => {
    const unlisten = listen("phi-assets-reload", () => {
      cache.current.clear();
      generation.current++;
      onLoad();
    });
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (url: string): HTMLImageElement | null | undefined => {
    const c = cache.current;
    if (c.has(url)) {
      const img = c.get(url)!;
      return img && img.complete ? img : img === null ? null : undefined;
    }
    const img = new Image();
    img.onload = onLoad;
    img.onerror = () => c.set(url, null);
    img.src = generation.current ? `${url}${url.includes("?") ? "&" : "?"}r=${generation.current}` : url;
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

/** 画像の保存(phi-ss)を頼まれたら、canvas を PNG にして保存し、main 窓へ場所を知らせる(#82) */
export function useScreenshot(kind: "map" | "eagleeye", canvas: RefObject<HTMLCanvasElement | null>, place?: string) {
  useEffect(() => {
    // to は、地図を main 窓の中に置いた時の宛先(map.tsx の MapPlace)。map 窓と両方で保存しないようにする
    const unlisten = listen<{ kind: string; label: string; to?: string }>("phi-ss", (e) => {
      if (e.payload.kind !== kind || (place && (e.payload.to ?? "map") !== place)) return;
      const c = canvas.current;
      if (!c) return;
      c.toBlob(async (blob) => {
        if (!blob) return;
        const png = Array.from(new Uint8Array(await blob.arrayBuffer()));
        const result = await invoke<string>("save_screenshot", { label: e.payload.label, kind, png }).then(
          (path) => ({ path }),
          (err) => ({ error: String(err) }),
        );
        emitTo("main", "phi-ss-saved", { kind, ...result }).catch(console.error);
      }, "image/png");
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [kind, canvas, place]);
}
