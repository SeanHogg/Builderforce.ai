/**
 * Host installer for run-linked change sets (G19).
 *
 * This module does not record anything until `installRunChangeSets` runs, and it
 * is not referenced by `extension.ts` or `brainRunHostPorts.ts`. Do not add that
 * call from a slice that must not edit those files, and do not call this and
 * `recordChangeSetAroundRun` for the same start — one baseline, one finalization.
 *
 * The one call the run host should add later, in place of assembling the library
 * itself, on the host `start` path:
 *
 *   return installRunChangeSets(ctx).aroundRun(
 *     { runId, author, stillRunning: () => isRunning(payload.chatId) },
 *     () => host.start(payload),
 *   );
 *
 * That records a content-hashed baseline before the start and a finalization
 * after it. A crash between them leaves the set partial. A restart calls
 * `readPhase`: a baseline and no finalization is partial; a recorded
 * finalization is finished. Nothing here fetches or applies a patch.
 */

import type { EntityDestination, LocalFirstStore } from "@builderforce/local-first";
import {
  readRunChangeSetPhase,
  recordChangeSetAroundRun,
  recordChangeSetBaseline,
  recordChangeSetFinalization,
  type ChangeSetCompleteness,
  type ChangeSetLifecycle,
  type RunChangeBaseline,
} from "./runChangeSets";

/** The one call `brainRunHostPorts.ts` should add on the host start path. Not present there. */
export const RUN_HOST_CHANGE_SET_LINE =
  "return installRunChangeSets(ctx).aroundRun({ runId, author, stillRunning: () => isRunning(payload.chatId) }, () => host.start(payload));";

/** Same key `localFirstStore` mints. Read it; never mint a second device id here. */
const DEVICE_KEY = "builderforce.localDeviceId";

/** The slice of `vscode.ExtensionContext` this installer reads. `activate`'s `context` satisfies it. */
export interface RunChangeSetHostContext {
  globalState: {
    get<T = unknown>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void> | Promise<void>;
  };
}

/** Test and host overrides. Production activation passes only `ctx`. */
export interface RunChangeSetPorts {
  store?: LocalFirstStore;
  deviceId?: string;
  now?: () => Date;
}

export interface InstalledRunChangeSets {
  /**
   * Content-hashed baseline, written once. A restart that sees only this is partial.
   * Does not capture git — the caller already has the snapshot.
   */
  recordBaseline(args: {
    runId: string;
    baseline: RunChangeBaseline;
    author: string;
    destination?: EntityDestination;
  }): Promise<ChangeSetLifecycle>;
  /**
   * Close the set. A baseline with no call here stays partial. A second call
   * returns the stored close. Does not apply a patch.
   */
  recordFinalization(args: {
    runId: string;
    baseline: RunChangeBaseline;
    author: string;
    changeSetIds: readonly string[];
    destination?: EntityDestination;
  }): Promise<ChangeSetLifecycle>;
  /** What a restart should believe. No fetch. */
  readPhase(runId: string): Promise<ChangeSetCompleteness>;
  /**
   * Baseline before `run`, finalization after. Evidence never fails the run.
   * A start that does not own the turn (`stillRunning`) opens nothing.
   */
  aroundRun<T>(
    args: {
      runId: string;
      author: string;
      destination?: EntityDestination;
      stillRunning?: () => boolean;
    },
    run: () => Promise<T>,
  ): Promise<T>;
}

interface OpenedPorts {
  store: LocalFirstStore;
  deviceId: string;
  now?: () => Date;
}

const installed = new WeakMap<object, InstalledRunChangeSets>();

async function readDeviceId(ctx: RunChangeSetHostContext): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const id = ctx.globalState.get<string>(DEVICE_KEY);
    if (typeof id === "string" && id.length > 0) return id;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("local_device_id_unavailable");
}

async function resolvePorts(ctx: RunChangeSetHostContext, ports: RunChangeSetPorts | undefined): Promise<OpenedPorts> {
  if (ports?.store && ports.deviceId) {
    return {
      store: ports.store,
      deviceId: ports.deviceId,
      ...(ports.now ? { now: ports.now } : {}),
    };
  }
  const { localBrainApplication } = await import("./localFirstStore");
  const host = ctx as Parameters<typeof localBrainApplication>[0];
  localBrainApplication(host);
  const deviceId = ports?.deviceId ?? (await readDeviceId(ctx));
  return {
    store: ports?.store ?? localBrainApplication(host).store,
    deviceId,
    ...(ports?.now ? { now: ports.now } : {}),
  };
}

function bindHandle(opening: Promise<OpenedPorts>): InstalledRunChangeSets {
  return {
    async recordBaseline(args) {
      const { store, deviceId, now } = await opening;
      return recordChangeSetBaseline(store, { deviceId, ...(now ? { now } : {}) }, args);
    },
    async recordFinalization(args) {
      const { store, deviceId, now } = await opening;
      return recordChangeSetFinalization(store, { deviceId, ...(now ? { now } : {}) }, args);
    },
    async readPhase(runId) {
      const { store } = await opening;
      return readRunChangeSetPhase(store, runId);
    },
    async aroundRun(args, run) {
      let opened: OpenedPorts;
      try {
        opened = await opening;
      } catch {
        return run();
      }
      return recordChangeSetAroundRun(
        {
          store: opened.store,
          deviceId: opened.deviceId,
          runId: args.runId,
          author: args.author,
          ...(args.destination ? { destination: args.destination } : {}),
          ...(args.stillRunning ? { stillRunning: args.stillRunning } : {}),
          ...(opened.now ? { now: opened.now } : {}),
        },
        run,
      );
    },
  };
}

/**
 * Install the change-set recorder for one host context. Idempotent per `ctx`.
 * Does not capture a baseline until `recordBaseline` or `aroundRun` is called,
 * and does not finalize until `recordFinalization` or `aroundRun` settles.
 */
export function installRunChangeSets(ctx: RunChangeSetHostContext, ports?: RunChangeSetPorts): InstalledRunChangeSets {
  const cached = installed.get(ctx);
  if (cached) return cached;
  const handle = bindHandle(resolvePorts(ctx, ports));
  installed.set(ctx, handle);
  return handle;
}
