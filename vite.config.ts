import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const page = (name: string) => new URL(`./ui/${name}.html`, import.meta.url).pathname;

// Tauri の devUrl(tauri.conf.json)と同じポートに固定する
export default defineConfig({
  root: "ui",
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // 窓ごとに1ページ
    rollupOptions: { input: { main: page("index"), map: page("map") } },
  },
});
