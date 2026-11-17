// 利用者ガイドの画面を撮る為に、Tauri の代わりに架空の返事を返して WPHI の main 窓を動かす。
// 受信行と画像は guide_server(src-tauri/examples)が返す。接続ボタンを押すと、その受信行を流す
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Channel } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { createRoot } from "react-dom/client";
import { DEFAULT_SETTINGS } from "../../ui/src/settings.ts";
import "../../ui/src/style.css";

const SERVER = "http://127.0.0.1:5180";
const text = (path: string) => fetch(SERVER + path).then((r) => r.text());
// ?modern でモダンの画面に、?smooth でスムーズ移動にする
const settings = { ...DEFAULT_SETTINGS, singleWindow: true, modern: location.search.includes("modern"), smoothMove: location.search.includes("smooth") };

mockIPC(
  async (cmd, args: any) => {
    switch (cmd) {
      case "get_settings":
        return settings;
      case "list_characters":
        return {
          characters: [
            { label: "Mirai", host: "phi.example.jp", port: 20017 },
            { label: "Mirai2", host: "phi.example.jp", port: 20033 },
          ],
          openTabs: [],
        };
      case "connect": {
        const ch = args.onEvent as Channel<unknown>;
        // 撮る側(shoot.mjs)が地図の演出の行を流す為
        (window as any).guideEffect = async (scene: string) => {
          for (const ev of JSON.parse(await text(`/effects?scene=${scene}`))) ch.onmessage(ev);
        };
        const events: unknown[] = JSON.parse(await text("/events"));
        // 地図は1歩ずつ届くように少し間を置く
        setTimeout(async () => {
          for (const ev of events) {
            ch.onmessage(ev);
            if ((ev as { type: string }).type === "map") await new Promise((r) => setTimeout(r, 60));
          }
          (window as any).guideReady = true;
        }, 50);
        return 1;
      }
      case "log_css":
        return text("/log_css");
      case "log_html":
        return text(`/log_html?text=${encodeURIComponent(args.text)}`);
      case "register_worlds":
        return [
          { name: "WPHI Guide", host: "phi.example.jp", port: 20017 },
          { name: "Example World", host: "phi.example.jp", port: 20033 },
        ];
      case "plugin:window|get_all_windows":
        return ["main"];
      case "plugin:app|version":
        return "9.9.9";
      case "menu_model":
        return [];
      case "set_map_view":
        (window as any).guideView = args;
        return null;
      // ?trace で時刻の記録(ui/src/trace.ts)を window.guideTrace に溜める
      case "trace_on":
        return location.search.includes("trace");
      case "trace":
        ((window as any).guideTrace ??= []).push(`${Math.round(args.at)} ${args.what}`);
        return null;
      case "download_items":
        return JSON.parse(await text("/download_items"));
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

mockWindows("main");
// 撮る側(shoot.mjs)がメニューを選ぶ為
(window as any).menu = (id: string) => emit("phi-menu", id);
// App は差し替えた後に読む。読んだ時に Tauri を呼ぶモジュール(trace.ts)が、差し替える前の物を呼ばないように
const { App } = await import("../../ui/src/App");
createRoot(document.getElementById("root")!).render(<App />);
