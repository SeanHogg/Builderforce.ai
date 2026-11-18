/**
 * The `RunTarget` port (PRD 31 §W9 phase 5) — ONE run loop, two places to run it.
 *
 * Both targets read the same `AppBlueprint` and hand the ONE preview surface
 * (`LivePreviewPanel`) and the agent's `runtime.*` tools the same `RunSession`:
 * - `browser`   — the app runs in this tab on our WebContainers runtime (free; D7);
 * - `container` — the app runs in the project's cloud-run container (W1; `livePreview`).
 *
 * The target is chosen from the blueprint (`chooseRunTarget`), never by a user branch,
 * and a target that cannot run the app says why (`RunDecline`) — the panel shows that
 * reason instead of a half-broken preview.
 */
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';

export type RunTargetId = 'browser' | 'container';

/**
 * Why a target declined. `code` is a stable key the UI localizes
 * (`livePreview.reason.<code>`); `detail` is the runtime's own explanation (a
 * service id, the offending command) shown under it as-is.
 */
export interface RunDecline {
  code: RunDeclineCode;
  detail?: string;
}

export type RunDeclineCode =
  /** No blueprint has been detected for the project yet. */
  | 'noBlueprint'
  /** The blueprint could not be read (the request failed) — not the same as "none yet". */
  | 'blueprintUnavailable'
  /** A service's runtime is not one the browser runs (wrangler/Miniflare, Docker, Nuxt, mobile). */
  | 'serviceDeclined'
  /** The database is not Postgres-compatible, or is pinned to another host, so PGlite cannot stand in. */
  | 'databaseDeclined'
  /** The blueprint maps to an application the runtime refuses (duplicate port, cycle…). */
  | 'invalidSpec'
  /** The project has no files to run, or some could not be read. */
  | 'noFiles'
  /** No container is holding a live preview for this project or run. */
  | 'noContainerPreview'
  /** The target failed to start at all (the runtime could not boot, the request failed). */
  | 'runtimeUnavailable'
  /** A newer run started before this one finished starting. */
  | 'superseded';

export type Acceptance = { ok: true } | ({ ok: false } & RunDecline);

export type RunServiceState = 'starting' | 'live' | 'failed' | 'stopped';

/** One service of a running app, as the preview surface shows it. */
export interface RunService {
  id: string;
  /** The tab label: the blueprint's service id, or the container's own label. Absent = the app's one service. */
  label?: string;
  state: RunServiceState;
  /** It serves pages a browser can show (a frontend or API), not a database or a one-off step. */
  previewable: boolean;
  /** Where a browser reaches it, once it listens. Absent for databases and one-off tasks. */
  url?: string;
  /** The last failure, until the service is live again. */
  error?: string;
}

export interface RunLogLine {
  serviceId: string;
  text: string;
  at: number;
}

/** A running app on one target. */
export interface RunSession {
  readonly targetId: RunTargetId;
  /** Every service, in start order. */
  services(): RunService[];
  url(serviceId: string): string | undefined;
  /** Output, history first then live. A target with no log channel yields an empty, closed stream. */
  logs(serviceId?: string): ReadableStream<RunLogLine>;
  /** Restart one service; the others keep running. */
  restart(serviceId: string): Promise<void>;
  /** Stop every service and release the session. */
  stop(): Promise<void>;
  /** Called whenever any service's state or URL changes. Returns the unsubscribe. */
  onState(listener: () => void): () => void;
}

/** What a target needs to start an app, beyond the blueprint. */
export interface RunContext {
  projectId: string;
  /** The run whose container holds the preview (container target), when known. */
  executionId?: number | null;
  /** The project's files, path → content (browser target). */
  loadFiles: () => Promise<RunFiles>;
}

/** The files to mount, and any the store listed but could not read. */
export interface RunFiles {
  files: Record<string, string>;
  unreadable: string[];
}

export type RunStart = { ok: true; session: RunSession } | ({ ok: false } & RunDecline);

export interface RunTarget {
  readonly id: RunTargetId;
  /**
   * `attach` — the app is already running elsewhere (a container run); opening the
   * preview just connects to it. `request` — starting it costs the user (their tab's
   * CPU and memory), so it starts only on an explicit Run.
   */
  readonly startsOn: 'attach' | 'request';
  /** Whether this target can run the app — synchronous and side-effect free. */
  accepts(blueprint: AppBlueprint | null): Acceptance;
  /**
   * Start the app. Resolves `ok: false` when the target turns out unable to run it
   * after all (no container is live). A rejection is a decline too (`runtimeUnavailable`),
   * except a plan-limit 402, which the surface renders as an upgrade gate.
   */
  start(blueprint: AppBlueprint | null, context: RunContext): Promise<RunStart>;
}

/** An empty, already-closed log stream — for a target without a log channel. */
export function closedLogStream(): ReadableStream<RunLogLine> {
  return new ReadableStream<RunLogLine>({ start: (controller) => controller.close() });
}
