import { describe, expect, it, vi } from "vitest";
import type { AnalyzerExec, ExecResult } from "@builderforce/agent-tools";
import { DEFAULT_REGISTRIES, type RunDelta, type SideFacts } from "@builderforce/run-delta";
import type { MaterializedTree } from "./analyzers/beforeTree";
import { MAX_REPO_DYNAMIC_MS, recomputeReserveMs, withDynamicTier, type DynamicTierDeps, type DynamicTierRun } from "./dynamicTier";

const STATIC_BUDGET_MS = 30_000;
const RECOMPUTE_RESERVE_MS = recomputeReserveMs(STATIC_BUDGET_MS);
import { computePrepared, type PreparedDelta } from "./preparedPorts";

const facts = (): SideFacts => ({ manifestGeneration: "g", merkleRoot: "m", findings: [], imports: new Map(), badges: new Map(), meta: {} });

function prepared(): PreparedDelta {
  return {
    input: { runId: "run-1", mode: "interactive", files: [{ path: "src/a.ts", beforeHash: "h1", afterHash: "h2", attribution: "run-modified-existing", status: "modified" }] },
    registries: DEFAULT_REGISTRIES,
    texts: {
      before: [["src/a.ts", { path: "src/a.ts", hash: "h1", text: "export const a = 1;\n" }]],
      after: [["src/a.ts", { path: "src/a.ts", hash: "h2", text: "export const a = 2;\n" }]],
    },
    facts: { before: facts(), after: facts() },
    churn: [],
    pastScores: [],
  };
}

/** A fake exec: vitest and StrykerJS installed, every changed file present, StrykerJS writes its report on each run. */
function fakeExec() {
  const runs: Array<{ argv: readonly string[]; cwd: string; env?: Readonly<Record<string, string>> }> = [];
  let ran = 0;
  const exec: AnalyzerExec = {
    async run(argv, o): Promise<ExecResult> { runs.push({ argv, cwd: o.cwd, ...(o.env ? { env: o.env } : {}) }); ran++; return { started: true, exitCode: 0, stdout: "", stderr: "" }; },
    which: async (p) => `/usr/bin/${p}`,
    neutralCwd: () => "/tmp",
    async readText(p) {
      if (p.endsWith("node_modules/vitest/package.json")) return '{"version":"3.2.0","bin":{"vitest":"vitest.mjs"}}';
      if (p.endsWith("node_modules/@vitest/coverage-v8/package.json")) return '{"version":"3.2.0"}';
      if (p.endsWith("node_modules/@stryker-mutator/core/package.json")) return '{"version":"8.7.1","bin":{"stryker":"bin/stryker.js"}}';
      if (p.endsWith("mutation.json")) return '{"files":{}}';
      return undefined;
    },
    mtime: async (p) => (p.endsWith("mutation.json") ? (ran > 0 ? ran : undefined) : 1),
    newestMtime: async () => undefined,
    writeText: async () => undefined,
    tempDir: async () => ({ path: "/scratch", dispose: async () => undefined }),
  };
  return { exec, runs };
}

async function setup(over: { optIn?: boolean; trusted?: boolean; overrides?: unknown; grant?: (ms: number) => number } = {}) {
  const p = prepared();
  const staticDelta = await computePrepared(p);
  const { exec, runs } = fakeExec();
  const materialize = vi.fn(async (_root: string, _files: unknown, _signal?: AbortSignal, mode?: string): Promise<MaterializedTree> =>
    ({ dir: `/copy-${mode}-${materialize.mock.calls.length}`, changedSince: async () => false, dispose: async () => undefined }));
  const extend = vi.fn(over.grant ?? ((ms: number) => ms));
  const announce = vi.fn();
  const run: DynamicTierRun = {
    root: "/repo", prepared: p, staticDelta, overrides: over.overrides, signal: new AbortController().signal, extend, announce,
  };
  const deps: DynamicTierDeps = {
    optIn: () => over.optIn ?? false, trusted: () => over.trusted ?? true, benchFiles: async () => [],
    compute: (q) => computePrepared(q), staticBudgetMs: STATIC_BUDGET_MS, exec, materialize: materialize as unknown as DynamicTierDeps["materialize"],
    copyParent: "/tmp-copies", env: {},
  };
  return { run, deps, runs, materialize, extend, announce, p };
}

const statuses = (d: RunDelta) => (d.dynamic ?? []).map((e) => [e.check, e.status, e.reason]);
const MANDATED_MUTATION = { dynamic: { require: { mutation: "always" } } };

describe("withDynamicTier (the editor's dynamic tier)", () => {
  it("untrusted workspace: no extension, no copy, no process — every check, mandated ones too, reads untrusted-workspace", async () => {
    const s = await setup({ trusted: false, optIn: true, overrides: MANDATED_MUTATION });
    const d = await withDynamicTier(s.run, s.deps);
    expect(s.extend).not.toHaveBeenCalled();
    expect(s.materialize).not.toHaveBeenCalled();
    expect(s.runs).toEqual([]);
    expect(statuses(d)).toEqual([
      ["benchmark", "skipped", "untrusted-workspace"], ["diff-coverage", "skipped", "untrusted-workspace"], ["mutation", "skipped", "untrusted-workspace"],
    ]);
  });

  it("opt-in off (the default): nothing runs, and the L3 phase's recompute from the prepared inputs KEEPS the statement (H1)", async () => {
    const s = await setup();
    const d = await withDynamicTier(s.run, s.deps);
    expect(s.extend).not.toHaveBeenCalled();
    expect(s.materialize).not.toHaveBeenCalled();
    expect(statuses(d)).toEqual([
      ["benchmark", "skipped", "not-configured"], ["diff-coverage", "skipped", "opt-in-off"], ["mutation", "skipped", "opt-in-off"],
    ]);
    // Phase 2 recomputes from the SAME prepared inputs: the dynamic record and its reasons survive the revision.
    const revised = await computePrepared({ ...s.p, options: { analyzers: "run" } });
    expect(revised.dynamic).toEqual(d.dynamic);
    expect(revised.dimensions.find((x) => x.id === "quality")!.reasons).toEqual(expect.arrayContaining(["dynamic-not-run:mutation"]));
  });

  it("a mandated check runs although opt-in is off: extended by its budget plus the recompute reserve, in COPIES, with a git ceiling", async () => {
    const s = await setup({ overrides: MANDATED_MUTATION });
    const d = await withDynamicTier(s.run, s.deps);
    expect(s.extend).toHaveBeenCalledWith(Math.min(15 * 60_000, MAX_REPO_DYNAMIC_MS) + RECOMPUTE_RESERVE_MS);
    expect(s.announce).toHaveBeenCalledWith(15);
    expect(s.materialize.mock.calls.map((c) => c[3])).toEqual(["copy", "copy"]);
    expect(statuses(d).find((e) => e[0] === "mutation")).toEqual(["mutation", "ok", undefined]);
    expect(s.runs.length).toBeGreaterThan(0);
    for (const r of s.runs) {
      expect(r.cwd).toMatch(/^\/copy-copy-/); // never the working tree
      expect(r.env?.GIT_CEILING_DIRECTORIES).toBe("/tmp-copies");
    }
    expect(d.dynamic!.find((e) => e.check === "mutation")!.scheduledBy).toEqual({ policy: "mandated" });
  });

  it("granted < wanted: the tier gets what was granted less the reserve; nothing granted ⇒ budget-exhausted, no copy", async () => {
    const some = await setup({ overrides: MANDATED_MUTATION, grant: () => RECOMPUTE_RESERVE_MS + 60_000 });
    await withDynamicTier(some.run, some.deps);
    expect(some.announce).toHaveBeenCalledWith(1);
    const none = await setup({ overrides: MANDATED_MUTATION, grant: () => RECOMPUTE_RESERVE_MS });
    const d = await withDynamicTier(none.run, none.deps);
    expect(none.announce).not.toHaveBeenCalled();
    expect(none.materialize).not.toHaveBeenCalled();
    expect(statuses(d).find((e) => e[0] === "mutation")).toEqual(["mutation", "skipped", "budget-exhausted"]);
  });
});
