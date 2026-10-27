import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSymbolIndex, type SymbolExtractor } from "./node-symbols.js";
import { extractSymbols } from "./symbols.js";

describe("WorkspaceSymbolIndex — watcher filtering and pluggable extractors", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-symbols-levers-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export function alpha() {}\n");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("ignores watcher events under skipped and dot directories — including its own snapshot", async () => {
    const parsed: string[] = [];
    const extractor: SymbolExtractor = { id: "counting", extract: (rel, content) => { parsed.push(rel); return extractSymbols(rel, content); } };
    const index = new WorkspaceSymbolIndex(root, {
      extractor,
      skipDirs: new Set(["node_modules", "bf-verify-fdc"]),
      cachePath: join(root, ".builderforce", "symbols.json"),
      fullRefreshMs: 60 * 60_000,
    });
    await index.find("alpha");
    parsed.length = 0;
    for (const noisy of ["node_modules/dep/index.ts", ".builderforce/symbols.json", ".git/HEAD", "bf-verify-fdc/x.ts", "node_modules"]) {
      index.markDirty(join(root, noisy));
    }
    await index.find("alpha");
    expect(parsed).toEqual([]);
    // A real source change still re-parses exactly that file.
    const file = join(root, "src", "a.ts");
    await writeFile(file, "export function alphaTwo() {}\n");
    await utimes(file, new Date(), new Date(Date.now() + 5_000));
    index.markDirty(file);
    expect((await index.find("alphaTwo")).total).toBe(1);
    expect(parsed).toEqual(["src/a.ts"]);
  });

  it("reads files with the configured extractor and re-parses a snapshot another extractor wrote", async () => {
    const cachePath = join(root, ".builderforce", "symbols.json");
    const regex = new WorkspaceSymbolIndex(root, { cachePath });
    await regex.find("alpha");
    const written = await vi.waitFor(async () => JSON.parse(await readFile(cachePath, "utf-8")) as { extractor?: string }, { timeout: 5_000, interval: 20 });
    // The regex extractor keeps the snapshot format it always wrote.
    expect(written.extractor).toBeUndefined();

    const custom: SymbolExtractor = { id: "custom-1", extract: async () => [{ name: "fromCustom", kind: "function", line: 1, exported: true }] };
    const next = new WorkspaceSymbolIndex(root, { cachePath, extractor: custom });
    expect((await next.find("fromCustom")).total).toBe(1);
    expect((await next.find("alpha")).total).toBe(0);
    const rewritten = await vi.waitFor(async () => {
      const snap = JSON.parse(await readFile(cachePath, "utf-8")) as { extractor?: string };
      if (snap.extractor !== "custom-1") throw new Error("not yet");
      return snap;
    }, { timeout: 5_000, interval: 20 });
    expect(rewritten.extractor).toBe("custom-1");
  });

  it("falls back to the regex extractor when the configured one throws", async () => {
    const broken: SymbolExtractor = { id: "broken", extract: async () => { throw new Error("wasm gone"); } };
    const index = new WorkspaceSymbolIndex(root, { extractor: broken });
    expect((await index.find("alpha")).total).toBe(1);
  });
});
