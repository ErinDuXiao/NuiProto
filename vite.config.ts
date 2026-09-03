/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // ホストから割り当てられたポートを使う（未指定なら既定の 5173）
    port: Number(process.env.PORT) || 5173,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
