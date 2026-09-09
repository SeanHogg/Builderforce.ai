import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { sourcePackageAliases } from "../../scripts/sourcePackages.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
/** `packages/` lives two levels up — the source-package registry keys off the REPO root. */
const repoRoot = path.resolve(here, "../..");

function normalizeBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed === "./") {
    return "./";
  }
  if (trimmed.endsWith("/")) {
    return trimmed;
  }
  return `${trimmed}/`;
}

export default defineConfig(() => {
  const envBase = process.env.BUILDERFORCE_AGENTS_CONTROL_UI_BASE_PATH?.trim();
  const base = envBase ? normalizeBase(envBase) : "./";
  return {
    base,
    publicDir: path.resolve(here, "public"),
    resolve: {
      // The source-only shared packages (`@builderforce/*`) ship no `dist`, so a
      // bundler that follows plain node resolution finds nothing. Derived from the
      // manifests rather than listed, so a new package needs no change here.
      alias: [...sourcePackageAliases(repoRoot)],
    },
    optimizeDeps: {
      include: ["lit/directives/repeat.js"],
    },
    build: {
      outDir: path.resolve(here, "../dist/control-ui"),
      emptyOutDir: true,
      sourcemap: true,
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
    },
  };
});
