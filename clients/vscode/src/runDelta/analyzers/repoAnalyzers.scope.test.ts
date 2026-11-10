/** The L3 tier's scope rules (PRD 41 §B7): only the clone groups a changed file is in; CodeQL only when the repository opted in. */

import { describe, expect, it } from "vitest";
import { composeAnchor } from "@seanhogg/builderforce-memory/knowledge";
import type { AnalyzerExec, AnalyzerSide, DeltaAnalyzer } from "@builderforce/agent-tools";
import { jscpdAnalyzer } from "@builderforce/agent-tools";
import type { AnalyzerResult, SideFacts } from "@builderforce/run-delta";
import type { PreparedDelta } from "../preparedPorts";
import type { AnalyzerCache } from "./analyzerCache";
import { analyzeRepo, codeqlLanguageOf, codeqlOptedIn, packageScopes } from "./repoAnalyzers";
import type { RunContext } from "./sideContext";

const facts = (merkleRoot: string): SideFacts => ({ manifestGeneration: "7", merkleRoot, findings: [], imports: new Map(), badges: new Map(), meta: {} });
const prepared: PreparedDelta = {
  input: { runId: "r1", mode: "interactive", files: [{ path: "src/a.ts", beforeHash: "b", afterHash: "a", attribution: "run-modified-existing", status: "modified" }] },
  registries: {} as PreparedDelta["registries"],
  texts: { before: [["src/a.ts", { path: "src/a.ts", hash: "b", text: "x\n" }]], after: [["src/a.ts", { path: "src/a.ts", hash: "a", text: "y\n" }]] },
  facts: { before: facts("rb"), after: facts("ra") }, churn: [], pastScores: [],
};
const CONTEXT: RunContext = { root: "/repo", universe: ["src/a.ts"], ignored: [], before: {}, configHash: "c", textOf: async () => undefined };
const group = (members: string[]) => ({
  kind: "clone-group", severity: "warn" as const, confidence: "measured" as const, params: {}, evidence: [],
  identity: { id: `g:${members.join("|")}`, anchor: composeAnchor("clone-group", 1, "group", members.join("|")), anchorKind: "group" as const, members },
});
const memoryCache = (): AnalyzerCache & { stored: AnalyzerResult[] } => {
  const stored: AnalyzerResult[] = [];
  return { stored, get: async () => undefined, put: async (_k, entry) => { stored.push(entry.result); } };
};

describe("L3 scope", () => {
  it("keeps only the clone groups that include a changed file — and caches the whole-tree result unfiltered", async () => {
    const fake: DeltaAnalyzer = {
      ...jscpdAnalyzer,
      run: async () => ({ tool: "jscpd", version: "4.0.5", status: "ok", findings: [group(["src/a.ts", "src/b.ts"]), group(["src/x.ts", "src/y.ts"])] }),
    };
    const cache = memoryCache();
    const out = await analyzeRepo("/repo", prepared, {
      exec: { newestMtime: async () => undefined } as unknown as AnalyzerExec, analyzers: [fake], entries: () => ({}), bundled: true,
      context: CONTEXT, cache: () => cache, treeHash: async (side: "before" | "after") => side,
      materialize: async () => ({ dir: "/t", changedSince: async () => false, dispose: async () => undefined }),
    });
    expect(out.after[0]!.findings.map((f) => f.identity.members)).toEqual([["src/a.ts", "src/b.ts"]]);
    expect(out.before[0]!.findings.map((f) => f.identity.members)).toEqual([["src/a.ts", "src/b.ts"]]);
    expect(cache.stored).toHaveLength(2);
    expect(cache.stored.every((r) => r.findings.length === 2)).toBe(true);
  });

  it("scopes jscpd to the workspace packages holding a changed file (nearest package.json, else the top-level folder)", () => {
    const universe = ["package.json", "packages/run-delta/package.json", "packages/run-delta/src/a.ts", "packages/run-delta/src/engine/b.ts", "docs/x.md", "packages/sarif/package.json"];
    expect(packageScopes(["packages/run-delta/src/a.ts", "packages/run-delta/src/engine/b.ts"], universe)).toEqual(["packages/run-delta"]);
    expect(packageScopes(["packages/run-delta/src/a.ts", "packages/sarif/src/c.ts"], universe)).toEqual(["packages/run-delta", "packages/sarif"]);
    expect(packageScopes(["docs/x.md"], ["docs/x.md"])).toEqual(["docs"]);
    expect(packageScopes(["README.md"], universe)).toEqual(["."]);
  });

  it("CodeQL runs only in an opted-in repository, with the database under the L3 cache keyed by the side", async () => {
    expect(codeqlOptedIn(["src/a.ts"], false)).toBe(false);
    expect(codeqlOptedIn([".github/codeql/codeql-config.yml"], false)).toBe(true);
    expect(codeqlOptedIn(["src/a.ts"], true)).toBe(true);
    expect(codeqlLanguageOf(["a.py", "b.ts"])).toBe("javascript-typescript");
    expect(codeqlLanguageOf(["README.md"])).toBeUndefined();

    const seen: AnalyzerSide[] = [];
    const codeql: DeltaAnalyzer = { tool: "codeql", run: async (side) => { seen.push(side); return { tool: "codeql", version: "2", status: "ok", findings: [] }; } };
    const base = {
      exec: { newestMtime: async () => undefined } as unknown as AnalyzerExec, analyzers: [codeql], entries: () => ({}), bundled: true, cache: () => memoryCache(),
      treeHash: async (side: "before" | "after") => side,
      materialize: async () => ({ dir: "/t", changedSince: async () => false, dispose: async () => undefined }),
    };
    await analyzeRepo("/repo", prepared, { ...base, context: CONTEXT });
    expect(seen.every((s) => s.codeql === undefined)).toBe(true);
    seen.length = 0;
    await analyzeRepo("/repo", prepared, { ...base, context: CONTEXT, codeql: true });
    const dirs = seen.map((s) => s.codeql?.create?.dbDir);
    expect(dirs.every((d) => d?.startsWith("/repo/.builderforce/cache/run-delta-analyzers/codeql-"))).toBe(true);
    expect(new Set(dirs).size).toBe(2); // one database per side (per tree)
    expect(seen.find((s) => s.side === "before")!.codeql?.sourceRoot).toBe("/t");
  });
});
