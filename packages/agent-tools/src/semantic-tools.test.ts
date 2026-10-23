import { describe, it, expect } from "vitest";
import type { CapabilityProvider, RepoMapResult, SemanticSearchResult } from "./capabilities.js";
import { buildCoreToolRegistry } from "./core-tools.js";
import { repoMapTool, semanticSearchTool } from "./semantic-tools.js";

function provider(
  search: (q: string, o: unknown) => SemanticSearchResult,
  repoMap: (o: unknown) => RepoMapResult = () => ({ ok: true, map: "" }),
): CapabilityProvider {
  return {
    capabilities: new Set(["repo.semantic"]),
    semantic: { search: async (q, o) => search(q, o), repoMap: async (o) => repoMap(o) },
  };
}

describe("semantic_search", () => {
  it("returns compact located hits and clamps the limit", async () => {
    let seen: unknown;
    const caps = provider((q, o) => {
      seen = o;
      return {
        ok: true,
        results: [
          { path: "api/src/billing.ts", startLine: 10, endLine: 32, symbol: "applyStripeWebhook", kind: "function_declaration", snippet: "export function applyStripeWebhook", score: 0.03, source: "hybrid" },
        ],
      };
    });
    const r = await semanticSearchTool.execute({ query: "stripe webhook", path: "api/src", limit: 900 }, { caps });
    expect(seen).toEqual({ scope: "api/src", limit: 25 });
    expect(r.data.results).toEqual([
      { at: "api/src/billing.ts:10-32", symbol: "applyStripeWebhook", kind: "function_declaration", via: "hybrid", snippet: "export function applyStripeWebhook" },
    ]);
  });

  it("says a miss during indexing is not proof of absence", async () => {
    const caps = provider(() => ({ ok: true, results: [], indexing: true }));
    const r = await semanticSearchTool.execute({ query: "anything" }, { caps });
    expect(String(r.data.note)).toMatch(/still being built/);
  });

  it("rejects an empty query without calling the index", async () => {
    const caps = provider(() => {
      throw new Error("must not be called");
    });
    const r = await semanticSearchTool.execute({ query: "  " }, { caps });
    expect(r.data).toEqual({ ok: false, error: "query is required" });
  });

  describe("adaptive K (C4)", () => {
    const hit = (i: number, score?: number) => ({ path: `src/f${i}.ts`, startLine: 1, endLine: 2, snippet: `f${i}`, source: "hybrid" as const, ...(score === undefined ? {} : { score }) });
    const scored = [0.95, 0.9, 0.85, 0.4, 0.3, 0.2, 0.1, 0.05].map((s, i) => hit(i, s));
    const adaptiveCaps = (results: ReturnType<typeof hit>[], adaptive: boolean): CapabilityProvider => ({
      capabilities: new Set(["repo.semantic"]),
      semantic: { adaptive, search: async () => ({ ok: true, results }), repoMap: async () => ({ ok: true, map: "" }) },
    });

    it("sends only the clear head when the host turned it on", async () => {
      const r = await semanticSearchTool.execute({ query: "x" }, { caps: adaptiveCaps(scored, true) });
      expect(r.data.total).toBe(3);
    });

    it("keeps the full default when off, when the model set a limit, or when hits carry no score", async () => {
      expect((await semanticSearchTool.execute({ query: "x" }, { caps: adaptiveCaps(scored, false) })).data.total).toBe(8);
      expect((await semanticSearchTool.execute({ query: "x", limit: 8 }, { caps: adaptiveCaps(scored, true) })).data.total).toBe(8);
      const unscored = scored.map((_, i) => hit(i));
      expect((await semanticSearchTool.execute({ query: "x" }, { caps: adaptiveCaps(unscored, true) })).data.total).toBe(8);
    });
  });
});

describe("repo_map", () => {
  it("passes focus and a clamped budget", async () => {
    let seen: unknown;
    const caps = provider(
      () => ({ ok: true, results: [] }),
      (o) => {
        seen = o;
        return { ok: true, map: "api/src/core.ts\n  1: export function core()\n" };
      },
    );
    const r = await repoMapTool.execute({ focus: ["api/src", 3, ""], maxTokens: 50 }, { caps });
    expect(seen).toEqual({ maxTokens: 200, focus: ["api/src"] });
    expect(r.data.map).toContain("core.ts");
  });

  it("passes a trimmed query through to the backing", async () => {
    let seen: unknown;
    const caps = provider(
      () => ({ ok: true, results: [] }),
      (o) => {
        seen = o;
        return { ok: true, map: "" };
      },
    );
    await repoMapTool.execute({ query: "  stripe webhook  " }, { caps });
    expect(seen).toEqual({ maxTokens: 1500, focus: [], query: "stripe webhook" });
  });
});

describe("gating", () => {
  it("only a surface backing repo.semantic is offered the semantic tools", () => {
    const registry = buildCoreToolRegistry();
    const names = (caps: string[]) => registry.toolsForCapabilities(new Set(caps) as never).map((t) => t.name);
    expect(names(["repo.read", "repo.search", "repo.symbols"])).not.toContain("semantic_search");
    expect(names(["repo.semantic"])).toEqual(expect.arrayContaining(["semantic_search", "repo_map"]));
  });
});
