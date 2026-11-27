import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sourcePackageAliases } from "../../scripts/sourcePackages.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  resolve: {
    alias: sourcePackageAliases(repoRoot),
  },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
