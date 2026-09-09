import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sourcePackageAliases } from "../../scripts/sourcePackages.mjs";

// Node-only tests for pure logic (no Playwright/browser dependency).
export default defineConfig({
  // Same derived alias set as the UI's own bundler: these tests compile the same
  // source, which now reaches a source-only `@builderforce/*` package.
  resolve: { alias: [...sourcePackageAliases(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."))] },
  test: {
    testTimeout: 120_000,
    include: ["src/**/*.node.test.ts"],
    environment: "node",
  },
});
