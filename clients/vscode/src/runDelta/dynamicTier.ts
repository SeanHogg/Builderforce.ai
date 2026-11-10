/**
 * The run delta's OPTIONAL dynamic tier on the editor (PRD 41 C6.2, C8.4): after the static delta is computed,
 * run-delta's `runDynamicTier` plans the checks — mandated by the project's `.builderforce/delta.json` (as of the BASELINE:
 * a run cannot change what judges it), else the person's opt-in (`builderforce.runDelta.dynamicTier`, machine-scoped, off
 * by default), else skipped with a reason — and agent-tools' runners run them through the analyzers' own process seam
 * (`nodeAnalyzerExec`).
 *
 * SAFETY. Project code runs only in a TRUSTED workspace (untrusted: every check `skipped/untrusted-workspace`, mandated
 * ones included), and only in two scratch COPIES (`analyzers/beforeTree.ts` in `copy` mode — never hard links): the after
 * tree (the working tree as it is) and the before tree. Every report, coverage included, lands in a copy; the user's own
 * files, `coverage/` and `reports/` are never written.
 *
 *  - Nothing ran (the default): the static delta, annotated (`dynamic-not-run:<check>` + `skipped` rows) — no recompute.
 *  - Something ran: the results are kept on the prepared inputs (`PreparedDelta.dynamic`, so the L3 phase's revision
 *    keeps them) and the delta is recomputed. When the related tests ran, the `coverage` analyzer measures the copy's
 *    fresh report now (`PreparedDelta.dynamicCoverage`), while the copy still exists.
 *
 * BUDGET. Minutes, not seconds: the tier gets min(policy `budgetMs`, {@link MAX_REPO_DYNAMIC_MS}); the delta's budget (and an
 * autonomous run's finalize gate) is extended by that PLUS the time the recompute needs ({@link recomputeReserveMs}: the
 * coverage measure and the engine's recompute, one static budget each),
 * within the run's total cap (`extend` answers what it granted). The progress card says "running dynamic checks, up to N
 * min" (`announce`). Never throws into the run: any failure leaves the static delta (annotated).
 */

import {
  changedCodeOf, dynamicRunners,
  type AnalyzerExec, type DynamicCheckIdLike, type DynamicHost, type DynamicRunnersLike, type SkipReasonLike,
} from "@builderforce/agent-tools";
import {
  annotateDynamicTier, DYNAMIC_CHECKS, dynamicPolicyOf, isMandated, runDynamicTier,
  type DynamicCheckContext, type DynamicCheckId, type DynamicCheckResult, type DynamicCheckScheduler, type DynamicRunners,
  type DynamicSkipReason, type RunDelta, type SequentialBenchmarkTest,
} from "@builderforce/run-delta";
import { beforeTreeFilesOf, materializeBeforeTree, type MaterializedTree } from "./analyzers/beforeTree";
import { coverageAnalyzer } from "./analyzers/coverageAnalyzer";
import { nodeAnalyzerExec } from "./analyzers/nodeAnalyzerExec";
import { analyzeRepo } from "./analyzers/repoAnalyzers";
import type { PreparedDelta } from "./preparedPorts";
import { tmpdir } from "node:os";

/** One repository's dynamic tier may run at most this long, whatever its policy asks. */
export const MAX_REPO_DYNAMIC_MS = 30 * 60_000;
/** Time kept for what follows the tier: the coverage measure and the engine's recompute (one more static budget each). */
export const recomputeReserveMs = (staticBudgetMs: number): number => 2 * staticBudgetMs;

/** One repository's static delta, ready for the tier. */
export interface DynamicTierRun {
  root: string;
  prepared: PreparedDelta;
  staticDelta: RunDelta;
  /** The repository's parsed `.builderforce/delta.json` AS OF THE BASELINE (undefined: none). */
  overrides: unknown;
  /** The branch the run finalizes on (`ChangeSetRepoBaseline.branch`). */
  branch?: string;
  /** The repository as synced (remote URL, else `local:<hash>`): the key of its scheduling history (`dynamicSchedule.ts`). */
  repository?: string;
  signal: AbortSignal;
  /** Grows the delta's budget (and the finalize gate) by up to `ms`; answers the ms GRANTED (the run's total cap applies). */
  extend(ms: number): number;
  /** Tells the progress card the tier is running, for up to `minutes`. */
  announce?(minutes: number): void;
}

export interface DynamicTierDeps {
  /** The person's opt-in (the machine-scoped VSIX setting). */
  optIn(): boolean;
  /** The workspace is trusted (`vscode.workspace.isTrusted`): false ⇒ no project code runs, mandated checks included. */
  trusted(): boolean;
  /** Root-relative vitest `bench` files of the repository. */
  benchFiles(root: string): Promise<string[]>;
  /** THE engine call over prepared data (`computeInWorker`). */
  compute(prepared: PreparedDelta, signal: AbortSignal): Promise<RunDelta>;
  /** The static delta's own budget (`finalizeRunDelta` `RUN_DELTA_BUDGET_MS`): the reserve after the tier is two of it. */
  staticBudgetMs: number;
  /** Default: the opt-in scheduler. WS20: the Thompson sampler, once the repository has the history for it. */
  scheduler?: DynamicCheckScheduler;
  /** D9.2: benchmarks as a sequential test (run-delta `sprtSignTest`). Absent: fixed rounds. */
  sequential?: SequentialBenchmarkTest;
  /** Hears what the tier decided and measured, with the final delta (the scheduler's history and §10 counts). Never throws into the run. */
  onTier?(report: { ctx: DynamicCheckContext; results: readonly DynamicCheckResult[]; staticDelta: RunDelta; delta: RunDelta }): void;
  exec?: AnalyzerExec;
  materialize?: typeof materializeBeforeTree;
  now?: () => number;
  env?: Readonly<Record<string, string | undefined>>;
  /** Where the copies live (the `GIT_CEILING_DIRECTORIES` of every run); default the OS temp folder (`beforeTree.ts` copy mode). */
  copyParent?: string;
  onError?(error: unknown): void;
}

// ─── The structural runner types equal run-delta's, both ways (a drift fails this type check) ─────────────────────────
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Assignable<A, B> = [A] extends [B] ? true : false;
export type DynamicRunnerContractsAgree = [
  Assert<Same<DynamicCheckIdLike, DynamicCheckId>>,
  Assert<Same<SkipReasonLike, DynamicSkipReason>>,
  Assert<Assignable<DynamicRunnersLike, DynamicRunners>>,
  Assert<Assignable<DynamicRunners, DynamicRunnersLike>>,
];

/**
 * Every dynamic run with `GIT_CEILING_DIRECTORIES=<the copies' parent>`: a `git` a tool starts inside a copy (which has no
 * `.git`) stops at the temp folder and never walks up into a repository above it.
 */
export function ceilinged(exec: AnalyzerExec, ceiling: string): AnalyzerExec {
  return { ...exec, run: (argv, opts) => exec.run(argv, { ...opts, env: { ...(opts.env ?? {}), GIT_CEILING_DIRECTORIES: ceiling } }) };
}

const touched = (d: RunDelta): DynamicCheckContext["dimensionsTouched"] =>
  d.dimensions.filter((x) => x.verdict !== "same" && x.verdict !== "not_measured").map((x) => x.id);

/** The scratch copies of both sides, made on first use, disposed together. */
function scratchTrees(run: DynamicTierRun, deps: DynamicTierDeps, signal: AbortSignal) {
  const made = new Map<"before" | "after", Promise<MaterializedTree | undefined>>();
  const materialize = deps.materialize ?? materializeBeforeTree;
  const tree = (side: "before" | "after"): Promise<MaterializedTree | undefined> => {
    let t = made.get(side);
    if (!t) {
      // `copy`: project code runs here. The after copy is the working tree as it is (nothing swapped).
      t = materialize(run.root, side === "before" ? beforeTreeFilesOf(run.prepared) : [], signal, "copy").catch(() => undefined);
      made.set(side, t);
    }
    return t;
  };
  return {
    dir: async (side: "before" | "after") => (await tree(side))?.dir,
    afterIfMade: async () => (made.has("after") ? (await made.get("after")!)?.dir : undefined),
    dispose: () => { for (const t of made.values()) void t.then((x) => x?.dispose()).catch(() => undefined); },
  };
}

/** The `coverage` analyzer over the after COPY, where the tier's test run left its report (`<copy>/coverage`). */
async function copyCoverage(run: DynamicTierRun, afterCopy: string, exec: AnalyzerExec): Promise<void> {
  const fresh = await analyzeRepo(afterCopy, run.prepared, {
    exec, analyzers: [coverageAnalyzer], cache: () => ({ get: async () => undefined, put: async () => undefined }),
  }, run.signal);
  const result = fresh.after.find((r) => r.tool === coverageAnalyzer.tool);
  // Provenance (D9.1 credit): this measurement exists because the tier's `diff-coverage` run left the report.
  if (result) run.prepared.dynamicCoverage = { ...result, producedBy: "diff-coverage" };
}

/** The final delta of one repository: the static one annotated, or recomputed with the tier's measurements. */
export async function withDynamicTier(run: DynamicTierRun, deps: DynamicTierDeps): Promise<RunDelta> {
  const { prepared, staticDelta } = run;
  const exec = ceilinged(deps.exec ?? nodeAnalyzerExec, deps.copyParent ?? tmpdir());
  const now = deps.now ?? (() => performance.now());
  const { policy } = dynamicPolicyOf(run.overrides);
  const inRun = prepared.input.files.filter((f) => f.attribution !== "outside-run" && f.afterHash !== undefined).map((f) => f.path);
  const trusted = deps.trusted();
  const base = {
    runId: prepared.input.runId, mode: prepared.input.mode, ...(run.branch ? { branch: run.branch } : {}),
    changedFiles: [...inRun].sort(), dimensionsTouched: touched(staticDelta),
    blastRadius: { score: staticDelta.blastRadius.score, band: staticDelta.blastRadius.band }, inputDigest: staticDelta.digest,
    optIn: deps.optIn(), trusted,
  };
  const wanted = Math.min(policy.budgetMs, MAX_REPO_DYNAMIC_MS);
  const mayRun = trusted && (base.optIn || DYNAMIC_CHECKS.some((c) => isMandated(policy, c, base)));
  // The tier's time is what the run's cap granted, less what the recompute after it needs.
  const reserve = recomputeReserveMs(deps.staticBudgetMs);
  const budget = mayRun ? Math.max(0, run.extend(wanted + reserve) - reserve) : 0;
  // Nothing may run (not trusted, not opted in, nothing mandated): no time was asked for, so none is "exhausted" — the
  // plan then says WHY (`untrusted-workspace`, `opt-in-off`), not `budget-exhausted`.
  const ctx: DynamicCheckContext = { ...base, remainingBudgetMs: mayRun ? budget : wanted };
  if (budget > 0) run.announce?.(Math.ceil(budget / 60_000));
  const signal = AbortSignal.any([run.signal, AbortSignal.timeout(Math.max(1, budget))]);

  const trees = scratchTrees(run, deps, signal);
  const host: DynamicHost = {
    exec, root: run.root.replace(/\\/g, "/"), tree: trees.dir, platform: process.platform, env: deps.env ?? process.env, now,
    benchFiles: mayRun ? await deps.benchFiles(run.root).catch(() => []) : [],
  };
  const settled = (delta: RunDelta, results: readonly DynamicCheckResult[]): RunDelta => {
    try {
      deps.onTier?.({ ctx, results, staticDelta, delta });
    } catch (error) {
      deps.onError?.(error);
    }
    return delta;
  };
  try {
    const results = await runDynamicTier({
      ctx, policy, changedCode: changedCodeOf(inRun), runners: dynamicRunners(host, now() + budget),
      ...(deps.scheduler ? { scheduler: deps.scheduler } : {}), ...(deps.sequential ? { sequential: deps.sequential } : {}), signal,
    });
    // Kept on the prepared inputs in EVERY outcome: the L3 phase recomputes from them, and its revision must still say
    // what of the tier did not run (the default, opt-in off, included).
    run.prepared.dynamic = results;
    if (results.every((r) => r.status === "skipped")) return settled(annotateDynamicTier(staticDelta, results), results);
    try {
      const afterCopy = await trees.afterIfMade();
      // The runner forced the report into the copy's `coverage/` (agent-tools `COVERAGE_DIR`), where the analyzer reads.
      if (afterCopy && results.some((r) => r.check === "diff-coverage" && r.status === "ok")) await copyCoverage(run, afterCopy, exec);
      return settled(await deps.compute(run.prepared, run.signal), results);
    } catch (error) {
      deps.onError?.(error);
      // The measurements could not be folded in: the static delta, saying the tier did not land (never as zero findings).
      const failed = results.map((r) => ({ ...r, status: "skipped" as const, reason: "recompute-failed", measurements: [] }));
      run.prepared.dynamic = failed;
      delete run.prepared.dynamicCoverage;
      return settled(annotateDynamicTier(staticDelta, failed), failed);
    }
  } finally {
    // Never awaited on the result path: removing a copied tree takes its own time.
    trees.dispose();
  }
}
