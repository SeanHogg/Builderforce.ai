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
});

describe("gating", () => {
  it("only a surface backing repo.semantic is offered the semantic tools", () => {
    const registry = buildCoreToolRegistry();
    const names = (caps: string[]) => registry.toolsForCapabilities(new Set(caps) as never).map((t) => t.name);
    expect(names(["repo.read", "repo.search", "repo.symbols"])).not.toContain("semantic_search");
    expect(names(["repo.semantic"])).toEqual(expect.arrayContaining(["semantic_search", "repo_map"]));
  });
});
