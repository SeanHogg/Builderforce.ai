/**
 * Activation wiring for interrupted-run recovery (G22).
 *
 * `extension.ts` calls `installRunRecovery(context)` at activation: every run the
 * previous extension host left `running`/`queued`/`awaiting_input` is journaled
 * `interrupted` (never falsely `completed`) and returned as `recovered`.
 *
 * The run host (`brainRunHostPorts.ts`, through `hostRunLifecycle.ts`) records the
 * whole lifecycle of each run it starts through the same handle:
 *
 *   - `recordStarted` when it starts a run it owns;
 *   - `recordCheckpoint` after each tool step — `safeToResume` only after a step that
 *     cannot repeat an external effect (a successful, non-mutating, local tool);
 *   - `recordFinished` from the host's TERMINAL run-status event (`completed`,
 *     `failed`, `cancelled`) — not because a start promise settled, which it does on
 *     failure too;
 *   - `recordHeld` instead of `completed` when the finalize gate holds the run
 *     (`runDelta/runHoldGate.ts`, PRD 41 §12.5): `awaiting_input` with its hold.
 *
 * A run with a recorded terminal status is never rewritten to `interrupted` by the
 * next activation; a run the host died inside still is. A continuation is a new turn
 * through the composer (the webview row); no recorded step is ever replayed.
 */

import type { EntityDestination, LocalFirstStore } from "@builderforce/local-first";
import {
  listInterruptedRuns,
  recoverInterruptedRuns,
  recordRunAcknowledged,
  recordRunCheckpoint,
  recordRunFinished,
  recordRunHeld,
  recordRunStarted,
  safeToResume,
  type InterruptedRun,
  type RunHold,
  type RunLifecycleDeps,
  type RunTerminalStatus,
} from "./runRecovery";

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
  /** A start that could not be journaled. Default `console.warn`. */
  onError?: (error: unknown) => void;
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
    /** The run's resume state as it starts (`RunResumeState`: its ask). */
    state?: unknown;
  }): Promise<void>;
  recordCheckpoint(args: { runId: string; step: number; safeToResume: boolean; state?: unknown }): Promise<void>;
  /**
   * The host's terminal run status. Do not call this because the host `start` promise
   * resolved — that promise resolves on failure too.
   */
  recordFinished(args: { runId: string; status: RunTerminalStatus }): Promise<void>;
  /** A completed run the finalize gate held: `awaiting_input` with its hold, never `completed`. */
  recordHeld(args: { runId: string; hold: RunHold }): Promise<void>;
  /** Every run still `interrupted` and unacknowledged: this activation's and earlier ones'. */
  interrupted(): Promise<InterruptedRun[]>;
  /** The person dismissed or resumed an interrupted run; it is never listed or recovered again. */
  recordAcknowledged(runId: string): Promise<void>;
  safeToResume(run: InterruptedRun): boolean;
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
  onError: (error: unknown) => void,
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
          ...(args.state !== undefined ? { state: args.state } : {}),
        });
      } catch (error) {
        // The run still starts; the next activation recovers whatever did commit.
        onError(error);
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
    async recordHeld(args) {
      const { store, deps } = await afterRecovery();
      await recordRunHeld(store, deps, args);
    },
    async interrupted() {
      const { store } = await afterRecovery();
      return listInterruptedRuns(store);
    },
    async recordAcknowledged(runId) {
      const { store, deps } = await afterRecovery();
      await recordRunAcknowledged(store, deps, { runId });
    },
    safeToResume,
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
  const onError = ports?.onError ?? ((error: unknown) => console.warn("run recovery:", error));
  const opening = resolvePorts(ctx, ports);
  const recovered = opening
    .then(({ store, deps }) => recoverInterruptedRuns(store, deps))
    .catch((error: unknown) => {
      // A journal that cannot be opened recovers nothing; say so instead of hiding it.
      onError(error);
      return [] as InterruptedRun[];
    });
  const handle = bindHandle(opening, recovered, onError);
  installed.set(ctx, handle);
  return handle;
}
