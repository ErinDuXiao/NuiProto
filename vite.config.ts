/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GitHub Pages は https://<user>.github.io/<repo>/ で配信されるため、
 * ビルド成果物のパスをリポジトリ名で前置きする必要がある。
 * 開発サーバーは常にルート配信なので base を分ける。
 */
const GH_PAGES_BASE = "/NuiProto/";

export default defineConfig(({ command }) => ({
  base: command === "build" ? GH_PAGES_BASE : "/",
  plugins: [react()],
  server: {
    // ホストから割り当てられたポートを使う（未指定なら既定の 5173）
    port: Number(process.env.PORT) || 5173,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
}));
