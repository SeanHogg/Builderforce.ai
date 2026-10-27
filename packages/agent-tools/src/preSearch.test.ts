import { describe, expect, it } from "vitest";
import type { RepoSearchResult, SymbolFindResult, SymbolMatch } from "./capabilities.js";
import { escapeRegex, extractIdentifiers, preSearch, preSearchFiles } from "./preSearch.js";

const match = (name: string, path: string, line: number, kind: SymbolMatch["kind"] = "function"): SymbolMatch => ({ name, path, line, kind, exported: true });

function ports(defs: Record<string, SymbolMatch[]>, refs: Record<string, Array<{ path: string; line: number; text: string }>>) {
  const asked: string[] = [];
  return {
    asked,
    findSymbol: async (name: string): Promise<SymbolFindResult> => {
      asked.push(`sym:${name}`);
      const matches = defs[name] ?? [];
      return { ok: true, query: name, total: matches.length, matches };
    },
    searchText: async (query: string): Promise<RepoSearchResult> => {
      asked.push(`rg:${query}`);
      const matches = refs[query] ?? [];
      return { ok: true, query, total: matches.length, matches };
    },
  };
}

describe("extractIdentifiers", () => {
  it("takes code-shaped words, backticked spans and calls — not English", () => {
    expect(extractIdentifiers("Why does resolveMembership pick the wrong tenant in `billing.chargeCard`?")).toEqual(["chargeCard", "resolveMembership"]);
    expect(extractIdentifiers("rename MAX_RETRIES and fix parse_config()")).toEqual(["MAX_RETRIES", "parse_config"]);
    expect(extractIdentifiers("please fix the login page, it is broken")).toEqual([]);
  });

  it("is bounded and de-duplicated", () => {
    expect(extractIdentifiers("abCd abCd efGh ijKl mnOp", 3)).toEqual(["abCd", "efGh", "ijKl"]);
  });
});

describe("preSearch", () => {
  it("returns exact definitions, then references that are not the definition line, as a bounded block", async () => {
    const p = ports(
      { resolveMembership: [match("resolveMembership", "api/src/auth.ts", 12), match("resolveMembershipCache", "api/src/c.ts", 3)] },
      { resolveMembership: [{ path: "api/src/auth.ts", line: 12, text: "export function resolveMembership(" }, { path: "api/src/routes.ts", line: 40, text: "  const m = resolveMembership(req)" }] },
    );
    const r = await preSearch("how does resolveMembership work?", p);
    expect(r.identifiers).toEqual(["resolveMembership"]);
    expect(r.definitions).toEqual([{ identifier: "resolveMembership", path: "api/src/auth.ts", line: 12, kind: "function", exported: true }]);
    expect(r.references.map((x) => `${x.path}:${x.line}`)).toEqual(["api/src/routes.ts:40"]);
    expect(r.block).toContain("`resolveMembership` defined at api/src/auth.ts:12");
    expect(r.block).toContain("api/src/routes.ts:40");
    expect(preSearchFiles(r)).toEqual(["api/src/auth.ts", "api/src/routes.ts"]);
  });

  it("names nothing ⇒ no lookups and an empty block", async () => {
    const p = ports({}, {});
    const r = await preSearch("make it nicer", p);
    expect(r.block).toBe("");
    expect(p.asked).toEqual([]);
  });

  it("a failing port is a missing part, never a throw", async () => {
    const r = await preSearch("where is fooBar", {
      findSymbol: async () => { throw new Error("index down"); },
      searchText: async () => ({ ok: true, matches: [{ path: "a.ts", line: 2, text: "fooBar()" }] }),
    });
    expect(r.definitions).toEqual([]);
    expect(r.references).toHaveLength(1);
  });

  it("searches an identifier's regex metacharacters literally", async () => {
    const p = ports({}, { "\\$scope": [{ path: "app.js", line: 3, text: "$scope.value = 1" }] });
    const r = await preSearch("why is $scope empty", p);
    expect(p.asked).toContain("rg:\\$scope");
    expect(r.references.map((x) => x.path)).toEqual(["app.js"]);
    expect(new RegExp(escapeRegex("$scope")).test("$scope.value")).toBe(true);
  });

  it("hands its stop to every text search, and starts none once stopped", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const stop = new AbortController();
    await preSearch("how does resolveMembership work?", {
      searchText: async (_q, signal) => {
        seen.push(signal);
        return { ok: true, matches: [] };
      },
    }, { signal: stop.signal });
    expect(seen).toEqual([stop.signal]);
    stop.abort();
    const p = ports({}, {});
    expect((await preSearch("how does resolveMembership work?", p, { signal: stop.signal })).block).toBe("");
    expect(p.asked).toEqual([]);
  });

  it("caps the block", async () => {
    const refs = Array.from({ length: 4 }, (_, i) => ({ path: `src/f${i}.ts`, line: i + 1, text: "x".repeat(400) }));
    const r = await preSearch("abCd efGh ijKl mnOp", ports({}, { abCd: refs, efGh: refs, ijKl: refs, mnOp: refs }), { maxChars: 600 });
    expect(r.block.length).toBeLessThanOrEqual(610);
  });
});
