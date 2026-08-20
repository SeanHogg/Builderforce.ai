/**
 * Guard: the `@builderforce/agent-tools` package ROOT must stay node-builtin-free.
 *
 * The Cloudflare Worker (`api`) imports the package index, so a `node:*` import anywhere
 * in the module graph reachable from `index.ts` breaks the Worker bundle. Node-only
 * helpers are allowed, but ONLY behind their own export condition (`./node-path`), which
 * the Worker never imports — this test is what keeps that boundary from eroding the next
 * time someone reaches for `node:path`.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = dirname(fileURLToPath(import.meta.url));

/** Modules published behind a node-only export condition (see package.json `exports`). */
const NODE_ONLY_MODULES = new Set(["node-path.ts"]);

function sourceFiles(): string[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => !NODE_ONLY_MODULES.has(f));
}

describe("worker safety", () => {
  it("has no `node:` import outside the node-only export condition", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(join(SRC, file), "utf8");
      // Strip block/line comments so the doc-comments that NAME `node:*` don't trip this.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/from\s+["']node:/.test(code) || /require\(\s*["']node:/.test(code)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not re-export the node-only module from the package index", () => {
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    for (const mod of NODE_ONLY_MODULES) {
      expect(index).not.toContain(mod.replace(/\.ts$/, ""));
    }
  });

  it("declares every node-only module as its own export condition", () => {
    const pkg = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8")) as {
      exports: Record<string, string>;
    };
    for (const mod of NODE_ONLY_MODULES) {
      expect(Object.values(pkg.exports)).toContain(`./src/${mod}`);
    }
  });
});
