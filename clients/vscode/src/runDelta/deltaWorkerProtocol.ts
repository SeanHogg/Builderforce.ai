/**
 * What the run delta's worker (`deltaWorker.ts`) sends its host (`deltaWorkerHost.ts`): the delta's arrays that grow with the
 * run (changed files, dependents, findings) as bounded parts (`workers/boundedTransfer.ts`), then `ok` with the rest — never
 * the whole delta as one `postMessage` clone.
 */

import type { RunDelta } from "@builderforce/run-delta";
import type { TransferPart } from "../workers/boundedTransfer";

/** The stable code of a delta over the transfer budget. */
export const RUN_DELTA_OVER_BUDGET = "run_delta_result_over_budget";

/** The delta's arrays that scale with the run. */
export const RUN_DELTA_ARRAYS = [
  "impact.changedFiles", "impact.renamed", "impact.dependents", "impact.entryPoints", "excluded",
  "dimensions.*.findings", "dimensions.*.metrics",
] as const;

export type DeltaWorkerReply =
  | TransferPart
  | { type: "ok"; delta: RunDelta }
  | { type: "error"; error: string; code?: string };
