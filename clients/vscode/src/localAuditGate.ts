/**
 * The finalize gate's outcome on an audit's run (PRD 41 §12.5), split from the audit store (`localAuditStore.ts`): the
 * run's `hold` when the gate held it, and a person's `waiver` when they released it, copied onto the audit-run record so
 * the audit's history says so. The run's EXECUTION record stays the one source of whether it is held
 * (`runDelta/runHoldState.ts`); this is the audit's own copy of the same facts. The status is never moved.
 */

import type { LocalFirstStore, RunHold, RunWaiver } from "@builderforce/local-first";
import { persistRun, type LocalAuditRunValue, type StoreDeps } from "./localAuditStore";

/** Records the hold, or its waiver, on an audit's run. A run that is not stored here (not an audit) is left alone; returns whether one was written. */
export async function recordLocalAuditGate(
  store: LocalFirstStore,
  deps: Pick<StoreDeps, "now">,
  args: { runId: string } & ({ hold: RunHold } | { waiver: RunWaiver }),
): Promise<boolean> {
  const run = await store.read((tx) => tx.get<LocalAuditRunValue>("audit-run", args.runId));
  if (!run) return false;
  const at = (deps.now?.() ?? new Date()).toISOString();
  const kind = "hold" in args ? "held" : "released";
  const change = "hold" in args ? { hold: args.hold } : { waiver: args.waiver };
  await persistRun(
    store,
    { ...run, version: run.version + 1, updatedAt: at, payload: { ...run.payload, ...change } },
    "update",
    `audit-run:${kind}:${args.runId}`,
  );
  return true;
}
