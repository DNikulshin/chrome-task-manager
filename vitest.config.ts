import path from "node:path";
import { defineConfig } from "vitest/config";

// Тесты не должны тянуть CRXJS-плагин: проверяем чистую логику из src/lib.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
