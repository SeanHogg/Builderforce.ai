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
 * resumed. A shell command or external action whose result was never recorded is
 * re-confirmed by a human, not re-executed, because replaying it could run it twice.
 *
 * Activation calls `installRunRecovery` (`installRunRecovery.ts`). That line is not in
 * `extension.ts` yet; this module stays inert until it is.
 */

import {
  newLocalRecord,
  UNBOUND_DESTINATION,
  type EntityDestination,
  type ExecutionValue,
  type LocalFirstStore,
  type LocalRecord,
} from "@builderforce/local-first";

export const RUN_LIFECYCLE_SCHEMA_VERSION = 1;

export interface RunLifecycleDeps {
  deviceId: string;
  now?: () => Date;
}

export type InterruptedRun = { runId: string; record: LocalRecord<ExecutionValue> };

/** Record that a run started. Safe to call again with the same id (a retried dispatch). */
export async function recordRunStarted(
  store: LocalFirstStore,
  deps: RunLifecycleDeps,
  args: { runId: string; chatId?: string; ticketId?: string; destination?: EntityDestination },
): Promise<void> {
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
        checkpoint: { step: 0, safeToResume: false },
      },
    });
    await tx.put(record);
    await tx.append({
      eventId: `execution:start:${args.runId}`,
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
  args: { runId: string; status: "completed" | "failed" },
): Promise<void> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  await store.transact(async (tx) => {
    const run = await tx.get<ExecutionValue>("execution", args.runId);
    if (!run || run.payload.status === "completed" || run.payload.status === "failed") return;
    await tx.put<ExecutionValue>(
      { ...run, version: run.version + 1, updatedAt: at, payload: { ...run.payload, status: args.status } },
      run.version,
    );
    await tx.append({
      eventId: `execution:${args.status}:${args.runId}`,
      clientEntityId: args.runId,
      entityType: "execution",
      operation: "update",
      schemaVersion: run.schemaVersion,
      occurredAt: at,
      dependsOn: [],
      destination: run.destination,
      payload: { status: args.status },
    });
  });
}

/**
 * Restart recovery: every run the dead host left `running`, `queued` or
 * `awaiting_input` is marked `interrupted` — truthfully unfinished, never falsely
 * completed — and returned so the caller can surface it. Nothing is replayed here:
 * resuming is a separate, explicit, checkpoint-gated decision.
 */
export async function recoverInterruptedRuns(store: LocalFirstStore, deps: RunLifecycleDeps): Promise<InterruptedRun[]> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  const recovered = await store.transact(async (tx) => {
    const stale = (await tx.list<ExecutionValue>("execution")).filter((record) =>
      record.payload.status === "running" || record.payload.status === "queued" || record.payload.status === "awaiting_input",
    );
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
        eventId: `execution:interrupted:${run.id}:${at}`,
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

/** Same rule as {@link safeToResume}. Kept so existing callers keep compiling. */
export function canResumeSafely(run: InterruptedRun): boolean {
  return safeToResume(run);
}

/**
 * A step the dead host may have been inside. `resultRecorded` is true only when a
 * durable result exists. Omitted or false is not evidence the action did not run.
 */
export interface PendingStep {
  name?: string;
  /** `read` | `analysis` may resume. `shell` | `external` | `command` never do. */
  kind?: string;
  /** True when the action leaves this process (HTTP, MCP, shell, push). */
  external?: boolean;
  resultRecorded?: boolean;
}

const SHELL_NAMES = new Set([
  "run_command",
  "run_terminal_cmd",
  "run_shell_command",
  "shell",
  "bash",
  "exec",
]);

/** Shell commands and external actions must not be re-executed from a missing result. */
export function isShellOrExternalStep(step: PendingStep): boolean {
  if (step.external === true) return true;
  const kind = (step.kind ?? "").toLowerCase();
  if (kind === "shell" || kind === "external" || kind === "command" || kind === "network" || kind === "remote") {
    return true;
  }
  const name = (step.name ?? "").toLowerCase();
  if (SHELL_NAMES.has(name)) return true;
  return name.startsWith("shell") || name.includes("terminal");
}

/**
 * A step may be re-entered only when a durable result was recorded and the step is a
 * pure read or analysis. No recorded result is not permission to run it. A shell
 * command or external action is never replayed, even when a result was recorded —
 * replaying it could run it twice.
 */
export function mayReplayStep(step: PendingStep): boolean {
  if (isShellOrExternalStep(step)) return false;
  if (step.resultRecorded !== true) return false;
  const kind = (step.kind ?? "").toLowerCase();
  return kind === "read" || kind === "analysis";
}

export interface ResumePlan {
  /** Continue from the safe checkpoint. Never means "mark the run completed". */
  resume: boolean;
  /** Steps the host may re-enter. Shell and external actions are never included. */
  steps: PendingStep[];
  /** Steps that need a human. Not passed to an executor. */
  blocked: PendingStep[];
}

/** Pending steps a checkpoint stored under `state.pending`, if any. */
export function pendingStepsOf(run: InterruptedRun): PendingStep[] {
  const state = run.record.payload.checkpoint?.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return [];
  const pending = (state as { pending?: unknown }).pending;
  if (!Array.isArray(pending)) return [];
  return pending.filter((step): step is PendingStep => !!step && typeof step === "object" && !Array.isArray(step));
}

/**
 * Resume only when the checkpoint was written safe. Steps without that flag, and every
 * shell or external action, are blocked — including when no result was recorded.
 */
export function resumePlan(run: InterruptedRun, pending: readonly PendingStep[] = pendingStepsOf(run)): ResumePlan {
  const blocked = pending.filter((step) => !mayReplayStep(step));
  const resume = safeToResume(run);
  return {
    resume,
    steps: resume ? pending.filter((step) => mayReplayStep(step)) : [],
    blocked,
  };
}

/**
 * Run only the plan's safe steps. A shell command or external action is not passed to
 * `execute`, even if a caller stuffed one into `steps`.
 */
export async function applyResumePlan(
  plan: ResumePlan,
  execute: (step: PendingStep) => Promise<void> | void,
): Promise<{ executed: PendingStep[]; blocked: readonly PendingStep[] }> {
  const executed: PendingStep[] = [];
  if (!plan.resume) return { executed, blocked: plan.blocked };
  for (const step of plan.steps) {
    if (!mayReplayStep(step) || isShellOrExternalStep(step)) continue;
    await execute(step);
    executed.push(step);
  }
  return { executed, blocked: plan.blocked };
}
