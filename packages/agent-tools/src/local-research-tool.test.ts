import { describe, expect, it } from "vitest";
import type { CapabilityProvider, LocalResearchCapability, LocalResearchMessage, ResearchFileFingerprint } from "./capabilities.js";
import { excerptAround, localResearchTool } from "./local-research-tool.js";
import { ResearchLru } from "./researchCache.js";
import { buildCoreToolRegistry } from "./core-tools.js";

const FILES: Record<string, string> = {
  "api/src/auth.ts": Array.from({ length: 200 }, (_, i) => (i === 99 ? "export function resolveMembership(req) {" : `// line ${i + 1}`)).join("\n"),
  "api/src/routes.ts": "import { resolveMembership } from './auth';\nconst m = resolveMembership(req);\n",
};

function surface(research: Partial<LocalResearchCapability> & Pick<LocalResearchCapability, "complete">, files = FILES) {
  const stats = new Map<string, ResearchFileFingerprint>(Object.keys(files).map((p) => [p, { path: p, mtimeMs: 1, size: files[p]!.length }]));
  const lru = new ResearchLru();
  const caps: CapabilityProvider = {
    capabilities: new Set(["repo.read", "repo.search", "repo.symbols", "local.research"]),
    repoRead: {
      listFiles: async () => ({ ok: true, paths: Object.keys(files) }),
      readFile: async (p) => (files[p] !== undefined ? { ok: true, path: p, content: files[p] } : { ok: false, error: "file not found" }),
      searchCode: async (q) => ({
        ok: true,
        query: q,
        matches: Object.entries(files).flatMap(([path, text]) => text.split("\n").flatMap((line, i) => (line.includes(q) ? [{ path, line: i + 1, text: line }] : []))),
      }),
    },
    symbols: {
      find: async (q) => ({ ok: true, query: q, matches: q === "resolveMembership" ? [{ path: "api/src/auth.ts", line: 100, kind: "function", name: q, exported: true }] : [] }),
    },
    research: {
      fingerprint: async (paths) => paths.flatMap((p) => (stats.has(p) ? [stats.get(p)!] : [])),
      cache: { get: async (k) => lru.get(k), set: async (k, v) => lru.set(k, v) },
      ...research,
    },
  };
  return { caps, stats };
}

describe("local_research", () => {
  it("is offered only on a surface backing local.research", () => {
    const registry = buildCoreToolRegistry();
    const names = (caps: string[]) => registry.toolsForCapabilities(new Set(caps) as never).map((t) => t.name);
    expect(names(["repo.read", "repo.search"])).not.toContain("local_research");
    expect(names(["repo.read", "local.research"])).toContain("local_research");
  });

  it("pre-searches to choose files, answers from excerpts, and caches until a file changes", async () => {
    const seen: LocalResearchMessage[][] = [];
    let calls = 0;
    const { caps, stats } = surface({ complete: async (m) => { seen.push([...m]); calls++; return `answer ${calls}`; } });
    const first = await localResearchTool.execute({ question: "how does resolveMembership pick the tenant?" }, { caps });
    expect(first.data).toMatchObject({ ok: true, answer: "answer 1", files: ["api/src/auth.ts", "api/src/routes.ts"] });
    expect(seen[0]![1]!.content).toContain("100: export function resolveMembership(req) {");

    const again = await localResearchTool.execute({ question: "how does resolveMembership pick the tenant?" }, { caps });
    expect(again.data).toMatchObject({ ok: true, answer: "answer 1", cached: true });
    expect(calls).toBe(1);

    stats.set("api/src/auth.ts", { path: "api/src/auth.ts", mtimeMs: 2, size: 999 });
    const afterEdit = await localResearchTool.execute({ question: "how does resolveMembership pick the tenant?" }, { caps });
    expect(afterEdit.data).toMatchObject({ ok: true, answer: "answer 2" });
    expect(afterEdit.data.cached).toBeUndefined();
  });

  it("returns the deterministic hits as a PARTIAL success when the local model runs out of time", async () => {
    const { caps } = surface({ complete: () => new Promise<string>(() => { /* never answers */ }), timeLimitMs: 30 });
    const r = await localResearchTool.execute({ question: "what calls resolveMembership?" }, { caps });
    expect(r.data).toMatchObject({ ok: true, partial: true, reason: "the local model ran out of time" });
    expect(String(r.data.hits)).toContain("api/src/auth.ts:100");
  });

  it("a failing local model is also a partial success, never a cached answer", async () => {
    let calls = 0;
    const { caps } = surface({ complete: async () => { calls++; throw new Error("runtime offline"); } });
    const r = await localResearchTool.execute({ question: "explain resolveMembership", paths: ["api/src/auth.ts"] }, { caps });
    expect(r.data).toMatchObject({ ok: true, partial: true });
    await localResearchTool.execute({ question: "explain resolveMembership", paths: ["api/src/auth.ts"] }, { caps });
    expect(calls).toBe(2);
  });

  it("hands the run's Stop to the pre-search's text searches", async () => {
    const { caps } = surface({ complete: async () => "ok" });
    const signals: Array<AbortSignal | undefined> = [];
    const searchCode = caps.repoRead!.searchCode;
    caps.repoRead!.searchCode = (q, scope, opts) => {
      signals.push(opts?.signal);
      return searchCode(q, scope, opts);
    };
    const stop = new AbortController();
    await localResearchTool.execute({ question: "how does resolveMembership pick the tenant?" }, { caps, signal: stop.signal });
    expect(signals).toEqual([stop.signal]);
  });

  it("refuses without a question, without a local model, and when nothing matches", async () => {
    const { caps } = surface({ complete: async () => "x" });
    expect((await localResearchTool.execute({}, { caps })).data.ok).toBe(false);
    expect((await localResearchTool.execute({ question: "tidy up the styling" }, { caps })).data.ok).toBe(false);
    const { research: _drop, ...without } = caps;
    expect((await localResearchTool.execute({ question: "explain resolveMembership" }, { caps: without })).data.ok).toBe(false);
  });
});

describe("excerptAround", () => {
  it("keeps numbered windows around the hit lines within the budget", () => {
    const text = Array.from({ length: 500 }, (_, i) => `row ${i + 1}`).join("\n");
    const out = excerptAround(text, [250], 10_000, 2);
    expect(out.split("\n")).toEqual(["248: row 248", "249: row 249", "250: row 250", "251: row 251", "252: row 252"]);
    expect(excerptAround(text, [], 60).length).toBeLessThanOrEqual(64);
  });
});
