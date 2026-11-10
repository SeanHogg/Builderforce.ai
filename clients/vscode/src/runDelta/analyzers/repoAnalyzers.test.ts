/** The run delta's L3 tier in the editor (PRD 41 §B7, §6 step 4): trust, the result cache key, the fallback tree, the port. */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { composeAnchor } from "@seanhogg/builderforce-memory/knowledge";
import type { AnalyzerExec, AnalyzerSide, DeltaAnalyzer } from "@builderforce/agent-tools";
import type { AnalyzerResult, SideFacts } from "@builderforce/run-delta";
import { computePrepared, preparedPorts, type PreparedDelta } from "../preparedPorts";
import { cacheKeyOf, type AnalyzerCache } from "./analyzerCache";
import { l3KeyOf } from "./l3Binding";
import { ignoredFolders, materializeBeforeTree, sweepOrphanedTrees } from "./beforeTree";
import { coverageAnalyzer } from "./coverageAnalyzer";
import { searchPath, whichOnPath } from "./nodeAnalyzerExec";
import { analyzeRepo } from "./repoAnalyzers";
import type { RunContext } from "./sideContext";

const facts = (merkleRoot: string, generation = "7"): SideFacts => ({
  manifestGeneration: generation, merkleRoot, findings: [], imports: new Map(), badges: new Map(), meta: {},
});

function prepared(over: Partial<PreparedDelta> = {}): PreparedDelta {
  return {
    input: { runId: "r1", mode: "interactive", files: [{ path: "src/a.ts", beforeHash: "b", afterHash: "a", attribution: "run-modified-existing", status: "modified" }] },
    registries: { guards: {}, capabilities: {}, weakCrypto: [], io: [], suppressions: [], matchers: [], blocking: [] } as unknown as PreparedDelta["registries"],
    texts: {
      before: [["src/a.ts", { path: "src/a.ts", hash: "b", text: "export const a = 1;\n" }]],
      after: [["src/a.ts", { path: "src/a.ts", hash: "a", text: "export const a = 2;\nexport const b = 3;\n" }]],
    },
    facts: { before: facts("root-before"), after: facts("root-after") },
    churn: [], pastScores: [],
    ...over,
  };
}

const CONTEXT: RunContext = { root: "/repo", universe: ["src/a.ts"], ignored: ["dist"], before: {}, configHash: "c", textOf: async () => undefined };

const group = (members: string[]) => ({
  kind: "clone-group",
  identity: { id: `clone-group:g:${members.join("|")}`, anchor: composeAnchor("clone-group", 1, "group", "jscpd~g"), anchorKind: "group" as const, members },
  severity: "warn" as const, confidence: "measured" as const, params: { members: members.length }, evidence: members.map((p) => ({ side: "after" as const, path: p })),
});

/** A fake jscpd whose output depends on the side. */
function fakeJscpd(calls: AnalyzerSide[]): DeltaAnalyzer {
  return {
    tool: "jscpd",
    run: async (side) => {
      calls.push(side);
      const members = side.side === "after" ? ["src/a.ts", "src/b.ts", "src/c.ts"] : ["src/a.ts", "src/b.ts"];
      return { tool: "jscpd", version: "4.0.5", status: "ok", findings: [group(members)] };
    },
  };
}

function memoryCache(seed: Record<string, AnalyzerResult> = {}): AnalyzerCache & { puts: string[] } {
  const store = new Map(Object.entries(seed).map(([k, result]) => [k, { result }]));
  const puts: string[] = [];
  return {
    puts,
    get: async (key) => store.get(key),
    put: async (key, entry) => { puts.push(key); store.set(key, entry); },
  };
}

/** The key the tier computes for the fake jscpd (no bundled entry, no declared inputs, scoped to `src`) on a tree. */
const jscpdKey = (tree: string) => l3KeyOf({ tool: "jscpd", side: "after", ctx: CONTEXT, entries: {}, inputs: undefined, tree, scopes: ["src"] });

const noExec = { newestMtime: async () => undefined } as unknown as AnalyzerExec;
/** The tree hash stands in for git's: one per side. */
const treeHash = async (side: "before" | "after") => (side === "after" ? "root-after" : "root-before");
const base = { exec: noExec, entries: () => ({}), bundled: true, context: CONTEXT, treeHash };

describe("analyzeRepo", () => {
  it("runs nothing in an untrusted workspace: every row skipped with its reason", async () => {
    const calls: AnalyzerSide[] = [];
    const out = await analyzeRepo("/repo", prepared(), { ...base, analyzers: [fakeJscpd(calls)], trusted: () => false });
    expect(calls).toEqual([]);
    expect(out).toEqual({
      before: [{ tool: "jscpd", version: "", status: "skipped", reason: "untrusted-workspace", findings: [] }],
      after: [{ tool: "jscpd", version: "", status: "skipped", reason: "untrusted-workspace", findings: [] }],
    });
  });

  it("reads the before side from the L3 result cache by its full key, and caches the after side under its own", async () => {
    const calls: AnalyzerSide[] = [];
    const cache = memoryCache({ [await jscpdKey("root-before")]: { tool: "jscpd", version: "4.0.5", status: "ok", findings: [group(["src/a.ts", "src/b.ts"])] } });
    let materialized = 0;
    const out = await analyzeRepo("/repo", prepared(), {
      ...base, analyzers: [fakeJscpd(calls)], cache: () => cache, materialize: async () => { materialized++; return undefined; },
    });
    expect(materialized).toBe(0);
    expect(calls.map((c) => c.side)).toEqual(["after"]);
    expect(calls[0]!.ignored).toEqual(["dist"]);
    expect(calls[0]!.scopes).toEqual(["src"]);
    expect(cache.puts).toEqual([await jscpdKey("root-after")]);
    expect(out.before[0]!.findings[0]!.identity.members).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("a key changes with the configuration, the declared inputs and the version — never a stale hit", () => {
    const k = { tool: "osv-scanner", version: "1", config: "c", inputs: "i", tree: "t" };
    const keys = new Set([cacheKeyOf(k), cacheKeyOf({ ...k, version: "2" }), cacheKeyOf({ ...k, config: "d" }), cacheKeyOf({ ...k, inputs: "j" }), cacheKeyOf({ ...k, tree: "u" })]);
    expect(keys.size).toBe(5);
  });

  it("materializes the before tree once on a miss as the fallback, caches only when it did not change meanwhile, never awaits dispose", async () => {
    const calls: AnalyzerSide[] = [];
    let disposed = false;
    const cache = memoryCache();
    const out = await analyzeRepo("/repo", prepared(), {
      ...base, analyzers: [fakeJscpd(calls)], cache: () => cache,
      materialize: async (_root, files) => {
        expect(files).toEqual([{ path: "src/a.ts", text: "export const a = 1;\n" }]);
        return { dir: "/tmp/before", changedSince: async () => true, dispose: () => new Promise<void>((r) => setTimeout(() => { disposed = true; r(); }, 50)) };
      },
    });
    const before = calls.find((c) => c.side === "before")!;
    expect(before.dir).toBe("/tmp/before");
    expect(before.changed).toEqual([{ path: "src/a.ts", text: "export const a = 1;\n" }]);
    expect(calls.find((c) => c.side === "after")!.changed[0]).toMatchObject({ beforeText: "export const a = 1;\n" });
    expect(cache.puts).toEqual([await jscpdKey("root-after")]); // the before tree moved while jscpd ran: not cached
    expect(disposed).toBe(false); // the result did not wait for the tree's removal
    expect(out.before[0]!.status).toBe("ok");
  });

  it("never caches a tree it cannot hash (no git)", async () => {
    const cache = memoryCache();
    await analyzeRepo("/repo", prepared(), {
      ...base, treeHash: async () => undefined, analyzers: [fakeJscpd([])], cache: () => cache, materialize: async () => undefined,
    });
    expect(cache.puts).toEqual([]);
  });

  it("a before tree that cannot be built leaves the before side failed with its reason", async () => {
    const out = await analyzeRepo("/repo", prepared(), { ...base, analyzers: [fakeJscpd([])], cache: () => memoryCache(), materialize: async () => undefined });
    expect(out.before[0]).toMatchObject({ tool: "jscpd", status: "failed", reason: "before-tree-unavailable" });
  });

  it("a changed-file tool needs no tree on the before side (its texts)", async () => {
    const calls: AnalyzerSide[] = [];
    const gitleaks: DeltaAnalyzer = { tool: "gitleaks", run: async (side) => { calls.push(side); return { tool: "gitleaks", version: "8", status: "ok", findings: [] }; } };
    let materialized = 0;
    await analyzeRepo("/repo", prepared(), { ...base, analyzers: [gitleaks], cache: () => memoryCache(), materialize: async () => { materialized++; return undefined; } });
    expect(materialized).toBe(0);
    expect(calls.find((c) => c.side === "before")).toMatchObject({ dir: "/repo", changed: [{ path: "src/a.ts", text: "export const a = 1;\n" }] });
  });

  it("feeds the engine through the prepared port: a grown clone group reads changed (grew)", async () => {
    const analyzers = await analyzeRepo("/repo", prepared(), {
      ...base, analyzers: [fakeJscpd([])], cache: () => memoryCache(),
      materialize: async () => ({ dir: "/tmp/before", changedSince: async () => false, dispose: async () => undefined }),
    });
    const delta = await computePrepared(prepared({ analyzers }));
    const clones = delta.dimensions.find((d) => d.id === "ilities.maintainability")!.findings.filter((f) => f.ruleId === "clone-group");
    expect(clones.map((f) => [f.lineage, f.change])).toEqual([["changed", "grew"]]);
    expect(await preparedPorts(prepared({ analyzers })).analyze!("after", "knip")).toMatchObject({ status: "skipped", reason: "tool-absent" });
  });

  it("phase 1 (options pending) computes the static tier with every analyzer pending", async () => {
    const delta = await computePrepared(prepared({ options: { analyzers: "pending" } }));
    const security = delta.dimensions.find((d) => d.id === "security")!;
    expect(security.measuredBy).toContainEqual({ tool: "gitleaks", version: "", status: "pending" });
  });
});

describe("coverageAnalyzer", () => {
  const side = (dir: string): AnalyzerSide => ({
    side: "after", dir, entries: {}, bundled: true,
    changed: [{ path: "pkg/src/a.ts", beforeText: "const a = 1;\n", text: "const a = 1;\nconst b = 2;\nconst c = 3;\n" }],
  });
  it("measures the changed lines from the package's lcov report", async () => {
    const files: Record<string, string> = { "/r/pkg/coverage/lcov.info": "SF:src/a.ts\nDA:1,1\nDA:2,1\nDA:3,0\nend_of_record\n" };
    const exec = { readText: async (p: string) => files[p], mtime: async (p: string) => (files[p] ? 2 : p.endsWith("a.ts") ? 1 : undefined) } as unknown as AnalyzerExec;
    const r = await coverageAnalyzer.run(side("/r"), exec);
    expect(r).toMatchObject({ tool: "coverage", status: "ok" });
    expect(r.metrics![0]).toMatchObject({ metricId: "coverage.diff", value: 5000 });
  });

  it("a report older than the edit, or none, is not measured — never 0%", async () => {
    const stale = { readText: async () => "SF:src/a.ts\nDA:2,0\nend_of_record\n", mtime: async (p: string) => (p.includes("coverage/lcov") ? 1 : 5) } as unknown as AnalyzerExec;
    expect(await coverageAnalyzer.run(side("/r"), stale)).toMatchObject({ status: "skipped", reason: "no-coverage" });
  });
});

describe("program lookup (no hijack)", () => {
  it("searches absolute PATH folders only, never `.` or a folder inside the repository", () => {
    const sep = path.delimiter;
    const repo = path.resolve(os.tmpdir(), "bf-repo");
    const dirs = searchPath({ PATH: [".", "relative/bin", path.join(repo, "node_modules", ".bin"), path.resolve(os.tmpdir(), "tools")].join(sep) }, [repo.replace(/\\/g, "/").toLowerCase(), repo.replace(/\\/g, "/")]);
    expect(dirs).toEqual([path.resolve(os.tmpdir(), "tools")]);
  });

  it("never resolves a name with a path in it", async () => {
    expect(await whichOnPath("./evil")).toBeUndefined();
    expect(await whichOnPath("bin/osv-scanner")).toBeUndefined();
  });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd });

describe("materializeBeforeTree", () => {
  it("links git's file list, swaps the in-run files, drops a file the run created, and leaves the working tree untouched", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-tree-"));
    try {
      git(root, "init", "-q");
      fs.mkdirSync(path.join(root, "src"));
      fs.writeFileSync(path.join(root, "src/a.ts"), "after\n");
      fs.writeFileSync(path.join(root, "src/new.ts"), "new\n");
      fs.writeFileSync(path.join(root, "keep.ts"), "keep\n");
      fs.writeFileSync(path.join(root, "app.tsbuildinfo"), "{}");
      const tree = await materializeBeforeTree(root, [{ path: "src/a.ts", text: "before\n" }, { path: "src/new.ts" }]);
      expect(tree).toBeDefined();
      expect(tree!.dir.replace(/\\/g, "/")).toContain("/.builderforce/cache/delta-before-");
      expect(fs.readFileSync(path.join(tree!.dir, "src/a.ts"), "utf8")).toBe("before\n");
      expect(fs.readFileSync(path.join(tree!.dir, "keep.ts"), "utf8")).toBe("keep\n");
      expect(fs.existsSync(path.join(tree!.dir, "src/new.ts"))).toBe(false);
      // A file a tool can write is a COPY: writing it never reaches the working tree.
      fs.writeFileSync(path.join(tree!.dir, "app.tsbuildinfo"), "changed");
      expect(fs.readFileSync(path.join(root, "app.tsbuildinfo"), "utf8")).toBe("{}");
      expect(await tree!.changedSince()).toBe(false);
      fs.writeFileSync(path.join(root, "keep.ts"), "edited meanwhile\n");
      fs.utimesSync(path.join(root, "keep.ts"), new Date(), new Date(Date.now() + 5_000));
      expect(await tree!.changedSince()).toBe(true);
      await tree!.dispose();
      expect(fs.existsSync(tree!.dir)).toBe(false);
      expect(fs.readFileSync(path.join(root, "src/a.ts"), "utf8")).toBe("after\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("ONE universe: a gitignored build folder is not in the tree and is named for the after-side tools to exclude", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-tree-"));
    try {
      git(root, "init", "-q");
      fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n");
      fs.mkdirSync(path.join(root, "dist"));
      fs.writeFileSync(path.join(root, "dist/bundle.js"), "x");
      fs.writeFileSync(path.join(root, "a.ts"), "a\n");
      const tree = await materializeBeforeTree(root, []);
      expect(fs.existsSync(path.join(tree!.dir, "dist"))).toBe(false);
      expect(await ignoredFolders(root)).toContain("dist");
      await tree!.dispose();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("a pnpm workspace link resolves to the package INSIDE the before tree, never the working tree's; dispose keeps node_modules", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-tree-"));
    try {
      git(root, "init", "-q");
      fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
      fs.writeFileSync(path.join(root, "package.json"), "{}");
      fs.mkdirSync(path.join(root, "packages/lib"), { recursive: true });
      fs.writeFileSync(path.join(root, "packages/lib/index.ts"), "export const v = 'after';\n");
      fs.mkdirSync(path.join(root, "node_modules/@ws"), { recursive: true });
      fs.mkdirSync(path.join(root, "node_modules/left-pad"), { recursive: true });
      fs.writeFileSync(path.join(root, "node_modules/left-pad/index.js"), "module.exports = 1;");
      fs.symlinkSync(path.join(root, "packages/lib"), path.join(root, "node_modules/@ws/lib"), "junction");
      const tree = await materializeBeforeTree(root, [{ path: "packages/lib/index.ts", text: "export const v = 'before';\n" }]);
      expect(fs.readFileSync(path.join(tree!.dir, "node_modules/@ws/lib/index.ts"), "utf8")).toBe("export const v = 'before';\n");
      expect(fs.readFileSync(path.join(tree!.dir, "node_modules/left-pad/index.js"), "utf8")).toBe("module.exports = 1;");
      await tree!.dispose();
      expect(fs.existsSync(path.join(root, "node_modules/left-pad/index.js"))).toBe(true);
      expect(fs.readFileSync(path.join(root, "packages/lib/index.ts"), "utf8")).toBe("export const v = 'after';\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("sweeps an orphaned tree an earlier session left, links first", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-tree-"));
    try {
      const real = path.join(root, "real");
      fs.mkdirSync(real);
      fs.writeFileSync(path.join(real, "keep.txt"), "keep");
      const orphan = path.join(root, ".builderforce/cache/delta-before-old");
      fs.mkdirSync(orphan, { recursive: true });
      fs.symlinkSync(real, path.join(orphan, "node_modules"), "junction");
      await sweepOrphanedTrees([root], Date.now() + 2 * 60 * 60_000);
      expect(fs.existsSync(orphan)).toBe(false);
      expect(fs.readFileSync(path.join(real, "keep.txt"), "utf8")).toBe("keep");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
