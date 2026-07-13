import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.ts"],
    exclude: ["node_modules"],
  },
  resolve: {
    alias: {
      "@services": resolve(__dirname, "../src/services"),
      "@utils": resolve(__dirname, "../src/utils"),
      "@transport": resolve(__dirname, "../src/transport"),
      "@types": resolve(__dirname, "../src/types"),
    },
  },
});