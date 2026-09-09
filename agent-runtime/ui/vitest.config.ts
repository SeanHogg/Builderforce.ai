import path from "node:path";
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { sourcePackageAliases } from "../../scripts/sourcePackages.mjs";

export default defineConfig({
  // Same derived alias set as the UI's own bundler: these tests compile the same
  // source, which now reaches a source-only `@builderforce/*` package.
  resolve: { alias: [...sourcePackageAliases(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."))] },
  test: {
    include: ["src/**/*.test.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium", name: "chromium" }],
      headless: true,
      ui: false,
    },
  },
});
