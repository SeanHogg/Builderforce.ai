import { describe, it, expect } from "vitest";
import type { CapabilityProvider, SymbolFindResult } from "./capabilities.js";
import { buildCoreToolRegistry } from "./core-tools.js";
import { fileOutlineTool, findSymbolTool, OUTLINE_MAX_ENTRIES } from "./symbol-tools.js";

function provider(files: Record<string, string>, find?: (q: string, o: unknown) => SymbolFindResult): CapabilityProvider {
  return {
    capabilities: new Set(["repo.read", "repo.symbols"]),
    repoRead: {
      listFiles: async () => ({ ok: true, paths: Object.keys(files) }),
      readFile: async (p) => (p in files ? { ok: true, path: p, content: files[p] } : { ok: false, path: p, error: "file not found" }),
      searchCode: async () => ({ ok: true, total: 0, matches: [] }),
    },
    symbols: { find: async (q, o) => (find ? find(q, o) : { ok: true, query: q, total: 0, matches: [], indexedFiles: 10 }) },
  };
}

describe("find_symbol", () => {
  it("returns one compact line per definition", async () => {
    const caps = provider({}, (q) => ({
      ok: true,
      query: q,
      total: 1,
      matches: [{ path: "api/src/git.ts", line: 115, kind: "function", name: "buildGitCommand", exported: true }],
      indexedFiles: 900,
    }));
    const r = await findSymbolTool.execute({ query: "buildGitCommand" }, { caps });
    expect(r.data.matches).toEqual(["api/src/git.ts:115 function buildGitCommand (export)"]);
  });

  it("passes scope, kind and a clamped limit through to the index", async () => {
    let seen: unknown;
    const caps = provider({}, (q, o) => {
      seen = o;
      return { ok: true, query: q, total: 0, matches: [] };
    });
    await findSymbolTool.execute({ query: "x", path: "api/src", kind: "class", limit: 500 }, { caps });
    expect(seen).toEqual({ scope: "api/src", kind: "class", limit: 50 });
  });

  it("explains a miss, and says so when the index is partial", async () => {
    const miss = await findSymbolTool.execute({ query: "nope" }, { caps: provider({}) });
    expect(String(miss.data.note)).toMatch(/search_code/);
    const partial = await findSymbolTool.execute(
      { query: "nope" },
      { caps: provider({}, (q) => ({ ok: true, query: q, total: 0, matches: [], partialIndex: true })) },
    );
    expect(String(partial.data.note)).toMatch(/PARTIAL/);
  });

  it("requires a query", async () => {
    expect((await findSymbolTool.execute({ query: "  " }, { caps: provider({}) })).data.ok).toBe(false);
  });
});

describe("file_outline", () => {
  it("lists a file's definitions with line numbers, read fresh from the file", async () => {
    const caps = provider({ "a.ts": "export function one() {}\nfunction two() {}\n" });
    const r = await fileOutlineTool.execute({ path: "a.ts" }, { caps });
    expect(r.data.symbols).toEqual(["L1 function one (export)", "L2 function two"]);
    expect(r.data.totalLines).toBe(3);
  });

  it("filters by kind and caps a huge outline with a note", async () => {
    const big = Array.from({ length: OUTLINE_MAX_ENTRIES + 10 }, (_, i) => `export const c${i} = ${i};`).join("\n");
    const r = await fileOutlineTool.execute({ path: "big.ts" }, { caps: provider({ "big.ts": big }) });
    expect((r.data.symbols as string[]).length).toBe(OUTLINE_MAX_ENTRIES);
    expect(String(r.data.note)).toMatch(/first 150 of 160/);
    const onlyFns = await fileOutlineTool.execute({ path: "big.ts", kind: "function" }, { caps: provider({ "big.ts": big }) });
    expect(onlyFns.data.total).toBe(0);
  });

  it("passes a read failure straight through", async () => {
    const r = await fileOutlineTool.execute({ path: "missing.ts" }, { caps: provider({}) });
    expect(r.data).toMatchObject({ ok: false, error: "file not found" });
  });
});

describe("capability gating", () => {
  it("is offered only where a surface backs repo.symbols", () => {
    const registry = buildCoreToolRegistry();
    const withIndex = registry.toolsForCapabilities(new Set(["repo.read", "repo.search", "repo.symbols"])).map((t) => t.name);
    const withoutIndex = registry.toolsForCapabilities(new Set(["repo.read", "repo.search"])).map((t) => t.name);
    expect(withIndex).toEqual(expect.arrayContaining(["find_symbol", "file_outline"]));
    expect(withoutIndex).not.toContain("find_symbol");
    expect(withoutIndex).not.toContain("file_outline");
  });
});
