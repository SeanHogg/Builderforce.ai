/**
 * Run lifecycle journaling and restart recovery (G22).
 *
 * Host-owned runs survive a closed panel, but until now nothing durable recorded that a
 * run was mid-flight when the extension host died — so a restart could neither show the
 * run as interrupted nor know whether its last step is safe to resume.
 *
 * Every lifecycle transition commits an `execution` record AND its journal event in one
 * transaction. Recovery never replays: an interrupted run is marked `interrupted` with
 * an explicit `safeToResume` marker, and only a checkpoint that was written as safe
 * (`recordRunCheckpoint` with `safeToResume: true` — e.g. after a pure read step) may be
 * continued. Nothing is replayed: a continuation is a NEW turn sent through the composer
 * (the webview's interrupted-run row), never a re-execution of a recorded step.
 *
 * Activation calls `installRunRecovery` (`installRunRecovery.ts`); the run host records
 * start, checkpoints and the terminal status through it (`hostRunLifecycle.ts`), so a
 * run that finished is never rewritten to `interrupted` by the next activation.
 */

import {
  isTerminalExecutionStatus,
  newLocalRecord,
  selectRecords,
  UNBOUND_DESTINATION,
  type EntityDestination,
  type ExecutionValue,
  type LocalFirstStore,
  type LocalRecord,
  type RunHold,
  type RunWaiver,
  type TerminalExecutionStatus,
} from "@builderforce/local-first";
import { childrenOfRecord } from "./childRunJournal";

export const RUN_LIFECYCLE_SCHEMA_VERSION = 1;

export interface RunLifecycleDeps {
  deviceId: string;
  now?: () => Date;
}

export type InterruptedRun = { runId: string; record: LocalRecord<ExecutionValue> };

/** How a run ended, as the host observed it. Stored as-is on the execution row. */
export type RunTerminalStatus = TerminalExecutionStatus;

export type { RunHold, RunWaiver };

/** The finalize gate's hold reason prefix (`runDelta/runHoldGate.ts`): the only hold a person may release. */
export const RUN_DELTA_HOLD_PREFIX = "run_delta_blocking:";

/** Refused: the run is not held at its finalize gate (absent, not `awaiting_input`, or held for another reason). */
export const RUN_DELTA_RELEASE_REFUSED = "run_delta_release_refused";

/** Is this execution held at its finalize gate, and so releasable? */
export function isReleasableHold(run: ExecutionValue | undefined): run is ExecutionValue & { hold: RunHold } {
  return run?.status === "awaiting_input" && !!run.hold && run.hold.reason.startsWith(RUN_DELTA_HOLD_PREFIX);
}

/** Thrown, before the store is touched, when a start names no run. */
export const RUN_ID_REQUIRED = "run_id_required";

function requireRunId(runId: string | null | undefined): string {
  if (typeof runId !== "string" || runId.trim() === "") throw new Error(RUN_ID_REQUIRED);
  return runId;
}

/**
 * Record that a run started. Safe to call again with the same id (a retried dispatch).
 * A missing or blank `runId` rejects with `run_id_required` and writes nothing.
 */
export async function recordRunStarted(
  store: LocalFirstStore,
  deps: RunLifecycleDeps,
  args: { runId: string; chatId?: string; ticketId?: string; destination?: EntityDestination; state?: unknown },
): Promise<void> {
  requireRunId(args.runId);
  const at = (deps.now?.() ?? new Date()).toISOString();
  await store.transact(async (tx) => {
    const existing = await tx.get<ExecutionValue>("execution", args.runId);
    if (existing) return;
    const record = newLocalRecord<ExecutionValue>({
      id: args.runId,
      entityType: "execution",
      deviceId: deps.deviceId,
      destination: args.destination ?? UNBOUND_DESTINATION,
      occurredAt: at,
      schemaVersion: RUN_LIFECYCLE_SCHEMA_VERSION,
      payload: {
        ...(args.chatId ? { chatId: args.chatId } : {}),
        ...(args.ticketId ? { ticketId: args.ticketId } : {}),
        status: "running",
        // The resume state as the run starts (its ask): a run interrupted before its first step still resumes on it.
        checkpoint: { step: 0, safeToResume: false, ...(args.state !== undefined ? { state: args.state } : {}) },
      },
    });
    await tx.put(record);
    await tx.append({
      idempotencyKey: `execution:start:${args.runId}`,
      clientEntityId: args.runId,
      entityType: "execution",
      operation: "create",
      schemaVersion: record.schemaVersion,
      occurredAt: at,
      dependsOn: [],
      destination: record.destination,
      payload: record.payload,
    });
  });
}

/**
 * Write a checkpoint. `safeToResume` must be reserved for steps whose replay cannot
 * repeat an external effect (reads, pure analysis); anything that ran a command, wrote
 * a file, or called a service checkpoints with `safeToResume: false`.
 */
export async function recordRunCheckpoint(
  store: LocalFirstStore,
  deps: RunLifecycleDeps,
  args: { runId: string; step: number; safeToResume: boolean; state?: unknown },
): Promise<void> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  await store.transact(async (tx) => {
    const run = await tx.get<ExecutionValue>("execution", args.runId);
    if (!run || run.payload.status !== "running") return;
    await tx.put<ExecutionValue>(
      {
        ...run,
        version: run.version + 1,
        updatedAt: at,
        payload: {
          ...run.payload,
          checkpoint: { step: args.step, safeToResume: args.safeToResume, ...(args.state !== undefined ? { state: args.state } : {}) },
        },
      },
      run.version,
    );
  });
}

/** Terminally finish a run. Once finished, recovery never touches it again. */
export async function recordRunFinished(
  store: LocalFirstStore,
  deps: RunLifecycleDeps,
  args: { runId: string; status: RunTerminalStatus },
): Promise<void> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  const { status } = args;
  await store.transact(async (tx) => {
    const run = await tx.get<ExecutionValue>("execution", args.runId);
    if (!run || isTerminalExecutionStatus(run.payload.status)) return;
    await tx.put<ExecutionValue>(
      { ...run, version: run.version + 1, updatedAt: at, payload: { ...run.payload, status } },
      run.version,
    );
    await tx.append({
      idempotencyKey: `execution:${status}:${args.runId}`,
      clientEntityId: args.runId,
      entityType: "execution",
      operation: "update",
      schemaVersion: run.schemaVersion,
      occurredAt: at,
      dependsOn: [],
      destination: run.destination,
      payload: { status },
    });
  });
}

/**
 * Hold a run whose turn completed (PRD 41 §12.5): it becomes `awaiting_input` with its `hold`, never `completed`. Written
 * instead of {@link recordRunFinished}; a run already terminal is left alone.
 */
export async function recordRunHeld(
  store: LocalFirstStore,
  deps: RunLifecycleDeps,
  args: { runId: string; hold: RunHold },
): Promise<void> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  const hold: RunHold = { reason: args.hold.reason, rules: [...args.hold.rules] };
  await store.transact(async (tx) => {
    const run = await tx.get<ExecutionValue>("execution", args.runId);
    if (!run || isTerminalExecutionStatus(run.payload.status)) return;
    await tx.put<ExecutionValue>(
      { ...run, version: run.version + 1, updatedAt: at, payload: { ...run.payload, status: "awaiting_input", hold } },
      run.version,
    );
    await tx.append({
      idempotencyKey: `execution:held:${args.runId}`,
      clientEntityId: args.runId,
      entityType: "execution",
      operation: "update",
      schemaVersion: run.schemaVersion,
      occurredAt: at,
      dependsOn: [],
      destination: run.destination,
      payload: { status: "awaiting_input", hold },
    });
  });
}

/**
 * A person's audited release of a run held at its finalize gate: `completed`, with its `hold` kept and the `waiver` (who,
 * when, the hold's rules) beside it. Any other run — absent, not held, held for another reason — rejects with
 * {@link RUN_DELTA_RELEASE_REFUSED} and nothing is written. Returns the waiver.
 */
export async function recordRunReleased(
  store: LocalFirstStore,
  deps: RunLifecycleDeps,
  args: { runId: string; by: string },
): Promise<RunWaiver> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  return store.transact(async (tx) => {
    const run = await tx.get<ExecutionValue>("execution", args.runId);
    if (!run || !isReleasableHold(run.payload)) throw new Error(RUN_DELTA_RELEASE_REFUSED);
    const waiver: RunWaiver = { by: args.by, at, rules: [...run.payload.hold.rules] };
    await tx.put<ExecutionValue>(
      { ...run, version: run.version + 1, updatedAt: at, payload: { ...run.payload, status: "completed", waiver } },
      run.version,
    );
    await tx.append({
      idempotencyKey: `execution:released:${args.runId}`,
      clientEntityId: args.runId,
      entityType: "execution",
      operation: "update",
      schemaVersion: run.schemaVersion,
      occurredAt: at,
      dependsOn: [`execution:held:${args.runId}`],
      destination: run.destination,
      payload: { status: "completed", waiver },
    });
    return waiver;
  });
}

/**
 * Did the dead host leave this run in flight? A run still `running`, `queued` or `awaiting_input` (but not one HELD
 * there: its hold outlives the host) - and a run whose own turn COMPLETED while sub-agents it started were still working
 * (`childRunJournal.ts` keeps them on the record): those children died with the editor, so the parent's work is not over,
 * and without this it was never surfaced to resume.
 */
export function leftInFlight(record: LocalRecord<ExecutionValue>): boolean {
  const { status } = record.payload;
  if (status === "awaiting_input" && record.payload.hold) return false;
  if (status === "running" || status === "queued" || status === "awaiting_input") return true;
  return status === "completed" && childrenOfRecord(record).some((child) => child.state === "running");
}

/**
 * Restart recovery: every run the dead host left in flight ({@link leftInFlight}) is marked `interrupted` — truthfully unfinished, never falsely
 * completed — and returned so the caller can surface it. Nothing is replayed here:
 * resuming is a separate, explicit, checkpoint-gated decision.
 */
export async function recoverInterruptedRuns(store: LocalFirstStore, deps: RunLifecycleDeps): Promise<InterruptedRun[]> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  const recovered = await store.transact(async (tx) => {
    const stale = await selectRecords<ExecutionValue>(tx, "execution", leftInFlight);
    for (const run of stale) {
      await tx.put<ExecutionValue>(
        {
          ...run,
          version: run.version + 1,
          updatedAt: at,
          payload: {
            ...run.payload,
            status: "interrupted",
            // The checkpoint's own safeToResume flag survives; absence means unsafe.
            checkpoint: run.payload.checkpoint ?? { step: 0, safeToResume: false },
          },
        },
        run.version,
      );
      await tx.append({
        idempotencyKey: `execution:interrupted:${run.id}:${at}`,
        clientEntityId: run.id,
        entityType: "execution",
        operation: "update",
        schemaVersion: run.schemaVersion,
        occurredAt: at,
        dependsOn: [],
        destination: run.destination,
        payload: { status: "interrupted" },
      });
    }
    return stale.map((run) => run.id);
  });
  return store.read(async (tx) =>
    Promise.all(recovered.map(async (runId) => ({ runId, record: (await tx.get<ExecutionValue>("execution", runId))! }))),
  );
}

/**
 * May this interrupted run be resumed without human re-confirmation?
 * Only an explicit safe checkpoint says yes. A missing checkpoint is not safe.
 */
export function safeToResume(run: InterruptedRun): boolean {
  return run.record.payload.status === "interrupted" && run.record.payload.checkpoint?.safeToResume === true;
}

/**
 * Every run still `interrupted` and not yet acknowledged. A run recovered at an earlier
 * activation stays here until a person resumes or dismisses it: recovery itself only
 * marks `running`/`queued`/`awaiting_input` rows, so without this read an interrupted run
 * would be listed once and lost on the next restart.
 */
export async function listInterruptedRuns(store: LocalFirstStore): Promise<InterruptedRun[]> {
  return store.read(async (tx) =>
    (await selectRecords<ExecutionValue>(tx, "execution", (record) => record.payload.status === "interrupted")).map((record) => ({
      runId: record.id,
      record,
    })),
  );
}

/**
 * The person dismissed (or resumed) an interrupted run. It becomes terminal `cancelled`
 * with `reason: "acknowledged"` on its journal event, so it is neither listed again by
 * {@link listInterruptedRuns} nor touched by the next recovery. Only an `interrupted`
 * run is acknowledged; anything else (running again, already finished) is left alone.
 */
export async function recordRunAcknowledged(
  store: LocalFirstStore,
  deps: RunLifecycleDeps,
  args: { runId: string },
): Promise<void> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  await store.transact(async (tx) => {
    const run = await tx.get<ExecutionValue>("execution", args.runId);
    if (!run || run.payload.status !== "interrupted") return;
    await tx.put<ExecutionValue>(
      { ...run, version: run.version + 1, updatedAt: at, payload: { ...run.payload, status: "cancelled" } },
      run.version,
    );
    await tx.append({
      idempotencyKey: `execution:acknowledged:${args.runId}`,
      clientEntityId: args.runId,
      entityType: "execution",
      operation: "update",
      schemaVersion: run.schemaVersion,
      occurredAt: at,
      dependsOn: [],
      destination: run.destination,
      payload: { status: "cancelled", reason: "acknowledged" },
    });
  });
}
