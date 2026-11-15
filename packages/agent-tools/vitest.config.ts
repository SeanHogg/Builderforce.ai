/**
 * Unit-test config for the shared tool contract. This package is pure, dependency-free
 * TypeScript (no `node:*`, no Worker/Env), so its tests need no environment, no setup
 * file and no isolation — they are the fastest gate in the repo and run standalone in CI.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { sourcePackageAliases } from "../../scripts/sourcePackages.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pkgSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src");

/**
 * This package ships compiled `.js` artifacts checked in next to the `.ts` sources
 * (NodeNext-style `./x.js` imports). Vite/Rolldown resolves a relative `./x.js`
 * specifier to the STALE committed `.js` file, splitting module identity: a test's
 * `vi.mock("./replicaPump.js")` then registers against one resolved copy while the
 * code under test imports another, so the spy never fires and the real (silent)
 * code runs. Worse, a `.js` file holding TypeScript syntax fails to parse outright
 * (`RolldownError: Parse failure`).
 *
 * Rewrite any relative `./<name>.js` / `../<name>.js` import to its sibling
 * `./<name>.ts` whenever that `.ts` exists under `src/` — the source of truth the
 * `.js` was generated from. `.js` files with no `.ts` sibling still resolve as-is.
 */
/**
 * Canonical form for a path this plugin maps, so every spelling of the same file
 * (different drive-letter casing from Vite vs vitest importers, `/` vs `\`) resolves
 * to ONE id. Without this, `./replicaPump.js` reached from a `c:/…` importer and a
 * `C:/…` importer resolved to two different absolute ids, and vitest's `vi.mock`
 * registry (keyed by resolved id) bound a different module instance than the import —
 * the spy never fired and the real (silent) code ran.
 */
function canon(p: string): string {
  const norm = path.normalize(p);
  return norm.length > 1 && norm[1] === ":" ? norm[0]!.toUpperCase() + norm.slice(1) : norm;
}

function tsSourceForJs() {
  return {
    name: "ts-source-for-js",
    enforce: "pre" as const,
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith(".js")) return null;
      // Resolve the specifier against the importer when present, else treat it as already absolute.
      let resolved: string;
      if (importer) {
        if (!source.startsWith("./") && !source.startsWith("../")) return null;
        resolved = path.resolve(path.dirname(importer), source);
      } else {
        if (!path.isAbsolute(source)) return null;
        resolved = source;
      }
      // Only remap within this package's own src; leave node_modules and other roots alone.
      const within = canon(resolved).startsWith(canon(pkgSrc) + path.sep);
      if (!within) return null;
      const ts = resolved.replace(/\.js$/, ".ts");
      return existsSync(ts) ? canon(ts) : null;
    },
  };
}

// The delta adapters import `@builderforce/sarif` by source; a source-only package has no
// install, so tests resolve it through the registry's aliases, as every host's do.
export default defineConfig({
  plugins: [tsSourceForJs()],
  resolve: { alias: sourcePackageAliases(repoRoot) },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
