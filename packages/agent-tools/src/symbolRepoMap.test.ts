import { describe, expect, it } from "vitest";
import type { CapabilityProvider } from "./capabilities.js";
import type { CodeSymbol } from "./symbols.js";
import { renderSymbolRepoMap, symbolIndexSemantic, type IndexedFile } from "./symbolRepoMap.js";
import { repoMapTool } from "./semantic-tools.js";

const sym = (name: string, line: number, exported = true, kind: CodeSymbol["kind"] = "function"): CodeSymbol => ({ name, line, exported, kind });

const FILES: IndexedFile[] = [
  { path: "api/src/billing/charge.ts", symbols: [sym("chargeCard", 10), sym("refund", 40), sym("helper", 80, false)] },
  { path: "api/src/auth/membership.ts", symbols: [sym("resolveMembership", 5), sym("Membership", 1, true, "interface")] },
  { path: "api/src/billing/charge.test.ts", symbols: [sym("fixture", 3)] },
  { path: "README.md", symbols: [sym("# Readme", 1, true, "heading")] },
];

describe("renderSymbolRepoMap", () => {
  it("lists files with their exported definitions, headings-only files left out", () => {
    const map = renderSymbolRepoMap(FILES);
    expect(map).toContain("api/src/billing/charge.ts\n  10: function chargeCard\n  40: function refund");
    expect(map).not.toContain("helper");
    expect(map).not.toContain("README.md");
  });

  it("ranks focus first, then query matches, and tests last", () => {
    const focused = renderSymbolRepoMap(FILES, { focus: ["api/src/auth"] });
    expect(focused.indexOf("api/src/auth/membership.ts")).toBe(0);
    const queried = renderSymbolRepoMap(FILES, { query: "charge card" });
    expect(queried.startsWith("api/src/billing/charge.ts")).toBe(true);
    const plain = renderSymbolRepoMap(FILES);
    expect(plain.indexOf("charge.test.ts")).toBeGreaterThan(plain.indexOf("membership.ts"));
  });

  it("stops at the token budget", () => {
    const many: IndexedFile[] = Array.from({ length: 400 }, (_, i) => ({ path: `src/m${i}.ts`, symbols: [sym(`fn${i}`, 1)] }));
    expect(renderSymbolRepoMap(many, { maxTokens: 200 }).length).toBeLessThanOrEqual(800);
  });
});

describe("symbolIndexSemantic", () => {
  it("serves repo_map from the index and says semantic search is unavailable", async () => {
    const semantic = symbolIndexSemantic(async () => FILES);
    const caps: CapabilityProvider = { capabilities: new Set(["repo.semantic"]), semantic };
    const r = await repoMapTool.execute({ focus: ["api/src/billing"] }, { caps });
    expect(r.data).toMatchObject({ ok: true });
    expect(String(r.data.map)).toContain("chargeCard");
    expect((await semantic.search("x")).ok).toBe(false);
  });

  it("an index failure is an error result, not a throw", async () => {
    const r = await symbolIndexSemantic(async () => { throw new Error("walk failed"); }).repoMap();
    expect(r.ok).toBe(false);
  });
});
