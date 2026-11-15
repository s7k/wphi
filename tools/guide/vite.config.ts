import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 利用者ガイドの画面を撮る為のページ。使い方は README.md
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  clearScreen: false,
  server: { port: 5179, strictPort: true },
});
