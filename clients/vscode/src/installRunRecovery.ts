/**
 * Activation wiring for interrupted-run recovery (G22).
 *
 * This module has no import side effects. It is safe if `extension.ts` does not call it
 * yet — nothing journals, and nothing replays, until `installRunRecovery` runs.
 *
 * Required call, not yet present (do not add it from a slice that must not edit
 * `extension.ts`). Inside `activate`, immediately before
 * `createVsCodeRunHost(context, …)`:
 *
 *   void installRunRecovery(context);
 *
 * `brainRunHostPorts.ts` is the run-host composition point. Another writer may own that
 * file; add one call, do not rewrite it. `installRunRecovery(ctx)` is idempotent for a
 * given context, so the host can take the activation handle and journal a start:
 *
 *   void installRunRecovery(ctx).recordStarted({ runId, chatId: String(chatId) });
 *
 * That call records `running` only. It does not mark the run completed when the host
 * promise settles — a settle is not proof the run finished, and a crash before an
 * explicit `recordFinished` must stay recoverable as `interrupted`. Resume only the
 * steps `resumePlan` lists. A shell command or external action is not replayed merely
 * because no result was recorded.
 */

import type { EntityDestination, LocalFirstStore } from "@builderforce/local-first";
import {
  applyResumePlan,
  recoverInterruptedRuns,
  recordRunCheckpoint,
  recordRunFinished,
  recordRunStarted,
  resumePlan,
  safeToResume,
  type InterruptedRun,
  type PendingStep,
  type ResumePlan,
  type RunLifecycleDeps,
} from "./runRecovery";

/** The one line `extension.ts` `activate` must add, immediately before `createVsCodeRunHost`. */
export const EXTENSION_ACTIVATION_LINE = "void installRunRecovery(context);";

/**
 * The one call `brainRunHostPorts.ts` should add on the host start path.
 * Do not pair it with `recordFinished("completed")`.
 */
export const RUN_HOST_START_LINE =
  "void installRunRecovery(ctx).recordStarted({ runId, chatId: String(chatId) });";

/** The slice of `vscode.ExtensionContext` this installer reads. `activate`'s `context` satisfies it. */
export interface RunRecoveryHostContext {
  globalState: {
    get<T = unknown>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void> | Promise<void>;
  };
}

/** Test and host overrides. Production activation passes only `ctx`. */
export interface RunRecoveryPorts {
  store?: LocalFirstStore;
  deviceId?: string;
  now?: () => Date;
}

export interface InstalledRunRecovery {
  /**
   * Runs the dead host left `running`, `queued`, or `awaiting_input`, now `interrupted`.
   * Never a false `completed`. Resolves to `[]` if the journal cannot be opened, so a
   * discarded activation call cannot reject unhandled.
   */
  recovered: Promise<InterruptedRun[]>;
  /** Host start path. Idempotent. Waits until activation recovery has committed. */
  recordStarted(args: {
    runId: string;
    chatId?: string | number;
    ticketId?: string | number;
    destination?: EntityDestination;
  }): Promise<void>;
  recordCheckpoint(args: { runId: string; step: number; safeToResume: boolean; state?: unknown }): Promise<void>;
  /**
   * Explicit terminal status only. Do not call this because the host `start` promise
   * resolved — that promise resolves on failure too.
   */
  recordFinished(args: { runId: string; status: "completed" | "failed" }): Promise<void>;
  safeToResume(run: InterruptedRun): boolean;
  resumePlan(run: InterruptedRun, pending?: readonly PendingStep[]): ResumePlan;
  applyResumePlan(
    plan: ResumePlan,
    execute: (step: PendingStep) => Promise<void> | void,
  ): Promise<{ executed: PendingStep[]; blocked: readonly PendingStep[] }>;
}

const DEVICE_KEY = "builderforce.localDeviceId";

const installed = new WeakMap<object, InstalledRunRecovery>();

function asId(value: string | number | undefined): string | undefined {
  if (value == null || value === "") return undefined;
  return String(value);
}

async function readDeviceId(ctx: RunRecoveryHostContext): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const id = ctx.globalState.get<string>(DEVICE_KEY);
    if (typeof id === "string" && id.length > 0) return id;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("local_device_id_unavailable");
}

async function resolvePorts(
  ctx: RunRecoveryHostContext,
  ports: RunRecoveryPorts | undefined,
): Promise<{ store: LocalFirstStore; deps: RunLifecycleDeps }> {
  if (ports?.store && ports.deviceId) {
    return { store: ports.store, deps: { deviceId: ports.deviceId, now: ports.now } };
  }
  const { localBrainApplication } = await import("./localFirstStore");
  const host = ctx as Parameters<typeof localBrainApplication>[0];
  // Mint (or reuse) the same device id the local store stamps on every other record.
  localBrainApplication(host);
  const deviceId = ports?.deviceId ?? (await readDeviceId(ctx));
  return {
    store: ports?.store ?? localBrainApplication(host).store,
    deps: { deviceId, now: ports?.now },
  };
}

function bindHandle(
  opening: Promise<{ store: LocalFirstStore; deps: RunLifecycleDeps }>,
  recovered: Promise<InterruptedRun[]>,
): InstalledRunRecovery {
  const afterRecovery = async (): Promise<{ store: LocalFirstStore; deps: RunLifecycleDeps }> => {
    const opened = await opening;
    await recovered;
    return opened;
  };

  return {
    recovered,
    async recordStarted(args) {
      // The documented host line is `void …recordStarted(…)`. A journal miss must not
      // reject that call, and must not fail a run the host has already decided to start.
      try {
        const { store, deps } = await afterRecovery();
        const chatId = asId(args.chatId);
        const ticketId = asId(args.ticketId);
        await recordRunStarted(store, deps, {
          runId: args.runId,
          ...(chatId ? { chatId } : {}),
          ...(ticketId ? { ticketId } : {}),
          ...(args.destination ? { destination: args.destination } : {}),
        });
      } catch {
        /* best-effort: the next activation still recovers whatever did commit */
      }
    },
    async recordCheckpoint(args) {
      const { store, deps } = await afterRecovery();
      await recordRunCheckpoint(store, deps, args);
    },
    async recordFinished(args) {
      const { store, deps } = await afterRecovery();
      await recordRunFinished(store, deps, args);
    },
    safeToResume,
    resumePlan,
    applyResumePlan,
  };
}

/**
 * Journal every run the previous host left in flight as `interrupted`, and return the
 * handle the run host uses to record the next start. Idempotent per `ctx`: a second
 * call does not recover again, so a start recorded after the first recover is not
 * immediately marked interrupted.
 *
 * The first call records later starts through `recordStarted`. The next call, on a
 * new context, recovers those runs. Only a checkpoint written `safeToResume` may be
 * resumed. `recoverInterruptedRuns` is invoked in this function, not in a helper.
 */
export function installRunRecovery(ctx: RunRecoveryHostContext, ports?: RunRecoveryPorts): InstalledRunRecovery {
  const cached = installed.get(ctx);
  if (cached) return cached;
  const opening = resolvePorts(ctx, ports);
  const recovered = opening
    .then(({ store, deps }) => recoverInterruptedRuns(store, deps))
    .catch(() => [] as InterruptedRun[]);
  const handle = bindHandle(opening, recovered);
  installed.set(ctx, handle);
  return handle;
}
