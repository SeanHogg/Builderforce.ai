/**
 * The editor's seams for the run delta's optional dynamic tier (`dynamicTier.ts`, PRD 41 C6.2/C8.4): the person's opt-in
 * (`builderforce.runDelta.dynamicTier`, machine-scoped, off by default), workspace trust (untrusted: no project code runs,
 * mandated checks included — they read `skipped/untrusted-workspace`), the repository's vitest `bench` files (the workspace
 * index, never a walk of its own), and the engine in its worker. Loaded with the other delta adapters (`runDeltaHost.ts`).
 */

import * as path from "node:path";
import * as vscode from "vscode";
import type { LocalFirstStore } from "@builderforce/local-first";
import { DEFAULT_BENCH_THRESHOLD, sprtSignTest, type DynamicCheckScheduler, type RunDelta } from "@builderforce/run-delta";
import { dynamicCheckOutcomes } from "@builderforce/run-delta/predict";
import { emitProductEvent } from "../telemetry/productEvents";
import { computeInWorker } from "./deltaWorkerHost";
import { RUN_DELTA_BUDGET_MS } from "./finalizeRunDelta";
import { readScheduleHistory, recordScheduleOutcomes, scheduleEvent, schedulerFor } from "./dynamicSchedule";
import { withDynamicTier, type DynamicTierRun } from "./dynamicTier";

/** The setting, under the `builderforce` section. */
export const DYNAMIC_TIER_SETTING = "runDelta.dynamicTier";
/** D9.1/D12 kill switch of the check scheduler model (default on): off ⇒ the opt-in default decides. */
export const CHECK_SCHEDULER_SETTING = "runDelta.predict.checkScheduler";

const BENCH_GLOB = "**/*.bench.{ts,mts,cts,tsx,js,mjs,cjs,jsx}";
const BENCH_EXCLUDE = "**/{node_modules,.git,.builderforce,dist,out,build,coverage}/**";
/** Bench files read at most (each is one vitest bench file; the runner reads every benchmark in each). */
const MAX_BENCH_FILES = 200;

async function benchFiles(root: string): Promise<string[]> {
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(root), BENCH_GLOB), BENCH_EXCLUDE, MAX_BENCH_FILES);
  return uris.map((u) => path.relative(root, u.fsPath).split(path.sep).join("/")).sort();
}

/** Where the scheduling history lives (`dynamicSchedule.ts`): the run delta's own store. */
export interface DynamicScheduleStore {
  store: LocalFirstStore;
  deviceId(): string;
}

/**
 * The `RunDeltaDeps.dynamic` of the editor. Benchmarks run as D9.2's sign-test SPRT (the runner falls back to the spec's
 * fixed rounds when the remaining budget cannot afford the SPRT's cap). With a `history` store, an opted-in person whose
 * repository has enough scheduling history gets the D9.1 Thompson sampler unless its kill switch is off (else the opt-in
 * default), and each run's outcomes are stored back, with the §10 counts sent when the sampler decided.
 */
export function deltaDynamicTier(onError: (error: unknown) => void, history?: DynamicScheduleStore): (run: DynamicTierRun) => Promise<RunDelta> {
  // Machine-scoped: a workspace's committed settings cannot turn it on (package.json `"scope": "machine"`).
  const optIn = (): boolean => vscode.workspace.getConfiguration("builderforce").get<boolean>(DYNAMIC_TIER_SETTING, false) === true;
  const samplerOn = (): boolean => vscode.workspace.getConfiguration("builderforce").get<boolean>(CHECK_SCHEDULER_SETTING, true) !== false;
  return async (run) => {
    const repository = run.repository;
    let scheduler: DynamicCheckScheduler | undefined;
    // The history is read only when it can matter: opted in (the sampler never runs what nobody asked for) and switched on.
    if (history && repository && optIn() && samplerOn()) {
      scheduler = await readScheduleHistory(history.store, repository).then(schedulerFor, (error: unknown) => (onError(error), undefined));
    }
    return withDynamicTier(run, {
      optIn,
      // The tier runs project code: never in an untrusted workspace, mandated checks included.
      trusted: () => vscode.workspace.isTrusted,
      benchFiles,
      compute: computeInWorker,
      staticBudgetMs: RUN_DELTA_BUDGET_MS,
      ...(scheduler ? { scheduler } : {}),
      sequential: sprtSignTest(DEFAULT_BENCH_THRESHOLD),
      onTier: ({ ctx, results, delta }) => {
        if (!history || !repository) return;
        const outcomes = dynamicCheckOutcomes(ctx, results, delta);
        const event = scheduleEvent(outcomes);
        if (event) emitProductEvent("delta.dynamic_scheduled", event);
        void recordScheduleOutcomes(history.store, { deviceId: history.deviceId(), at: new Date().toISOString() }, { runId: ctx.runId, repository, outcomes })
          .catch(onError);
      },
      onError,
    });
  };
}
