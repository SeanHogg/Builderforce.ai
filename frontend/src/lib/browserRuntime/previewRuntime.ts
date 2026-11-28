/**
 * The page's in-browser runtime (BuilderForce WebContainers), booted once and
 * shared: the instant preview, `npm install`, dev servers and the terminal all
 * run on this one instance.
 *
 * Relay mode: the preview is served from `preview.builderforce.ai`, never from
 * the app's own origin — and so are the processes (`node`, `npm`, the shell,
 * `python`/`pip`/`uvicorn`, `php`/`composer`), which the relay starts on that origin. Canvas projects run AI-written code and
 * arbitrary npm packages; on builderforce.ai they could read the user's session.
 * The API serves the relay page and workers there
 * (`api/src/presentation/middleware/browserPreviewOrigin.ts`). Applications get their own
 * origin, egress policy and shield telemetry from `previewRuntimeOptions.ts`. The runtime's
 * `id` is the project it is first booted for (`bootSharedPreviewRuntime(owner, projectId)`).
 *
 * The package is imported lazily, so the editor's bundle pays nothing until Run.
 *
 * No "Built with" badge here: this preview is the builder's own workspace, inside
 * Builderforce already. The badge belongs on the PUBLISHED site, where the platform
 * adds its own ("Made with Builderforce.ai", free tier) — `api/src/application/ide/siteAttribution.ts`.
 */
import type { PreviewRuntime } from '@seanhogg/builderforce-webcontainers';
import { recordedFailure } from '@/lib/reportError';
import { PREVIEW_PHP_OPTIONS } from './previewPhpOptions';
import { previewDotnetOptions } from './previewDotnetOptions';
import { previewRuntimeIdOf, previewShieldOptions } from './previewRuntimeOptions';
import { attachPreviewSignals } from './previewSignals';
import { loadWebcontainers } from './webcontainersPackage';
import { measureFiles, setPreviewRunningProbe, timeWrite } from './writeTiming';

const RELAY_URL = process.env.NEXT_PUBLIC_PREVIEW_RELAY_URL || 'https://preview.builderforce.ai/__bfwc/relay.html';

let booting: Promise<PreviewRuntime> | null = null;

/**
 * Who is using the shared runtime right now. ONE owner at a time: the runtime holds
 * one project's files, so a second user would write over the first's. Taking it from
 * another owner REVOKES that owner first (awaited) — e.g. the panel's browser run
 * disposes its application before the workspace mounts its files, and the other way
 * round. The editor's own consumers (instant preview, dev server, shell, installs)
 * are ONE owner, {@link WORKSPACE_OWNER}, so they never revoke each other.
 */
export interface PreviewRuntimeOwner {
  id: string;
  /** Called once when another owner takes the runtime; the runtime is theirs once it settles. */
  onRevoked?: () => void | Promise<void>;
}

/** A process the runtime started (`runtime.run(…)`). */
export type RuntimeProcess = ReturnType<PreviewRuntime['run']> & { killTree?: () => void };

/** The editor's processes on the runtime (dev server, terminal, commands) — stopped when it loses the runtime. */
const workspaceProcesses = new Set<RuntimeProcess>();
const workspaceRevokeListeners = new Set<() => void>();

/** Track a process the workspace started, so a revocation stops it. Returns the process. */
export function trackWorkspaceProcess<P extends RuntimeProcess>(process: P): P {
  workspaceProcesses.add(process);
  void process.wait().then(() => workspaceProcesses.delete(process), () => workspaceProcesses.delete(process));
  return process;
}

/** Hear when the workspace loses the runtime (its instant preview stops writing, say). */
export function onWorkspaceRevoked(listener: () => void): () => void {
  workspaceRevokeListeners.add(listener);
  return () => { workspaceRevokeListeners.delete(listener); };
}

export const WORKSPACE_OWNER: PreviewRuntimeOwner = {
  id: 'workspace',
  onRevoked: () => {
    for (const process of workspaceProcesses) {
      if (process.killTree) process.killTree();
      else process.kill();
    }
    workspaceProcesses.clear();
    for (const listener of [...workspaceRevokeListeners]) listener();
  },
};

/** How long a revoked owner gets to let go before the claimant goes ahead anyway. */
export const REVOKE_TIMEOUT_MS = 5_000;
/** Times a claim is retried when another claimant took the runtime while it waited. */
const CLAIM_ATTEMPTS = 3;

let owner: PreviewRuntimeOwner | null = null;

/** The current owner's id, or null. */
export function sharedPreviewRuntimeOwner(): string | null {
  return owner?.id ?? null;
}

/** Revoke `previous`, bounded: a revocation that hangs or throws must not hold the runtime forever. */
async function revoke(previous: PreviewRuntimeOwner): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, REVOKE_TIMEOUT_MS); });
  try {
    await Promise.race([Promise.resolve().then(() => previous.onRevoked?.()), timeout]);
  } catch (error) {
    recordedFailure(`Revoking the browser runtime from ${previous.id}`, undefined)(error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Boot the page's runtime (once) and acquire it for `claimant` — every use of the
 * runtime goes through here, so every user holds the lease. After revoking the previous
 * owner it checks it still holds the claim (another claimant may have taken it while it
 * waited) and claims again, a bounded number of times. `projectId` is the runtime's id
 * when this call boots it (ignored once it is booted).
 */
export async function bootSharedPreviewRuntime(claimant: PreviewRuntimeOwner = WORKSPACE_OWNER, projectId?: string): Promise<PreviewRuntime> {
  if (projectId) currentProjectId = projectId;
  const runtime = await bootRuntime(projectId);
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const previous = owner;
    owner = claimant;
    if (!previous || previous.id === claimant.id) return runtime;
    await revoke(previous);
    if (owner?.id === claimant.id) return runtime;
  }
  throw new Error('The browser runtime is being claimed by another part of the page; try again.');
}

/** Give the runtime back (a no-op unless `ownerId` holds it). Nothing is stopped: the owner did that. */
export function releaseSharedPreviewRuntime(ownerId: string): void {
  if (owner?.id === ownerId) owner = null;
}

/** The id the page's runtime was booted with (it keys every application's preview origin), or null before boot. */
let runtimeId: string | null = null;
/** The project the runtime was last claimed for (shield events no application owns are filed under it). */
let currentProjectId: string | null = null;

/** The booted runtime's id: the project it was first booted for, else `workspace` ({@link previewRuntimeIdOf}). */
export function sharedPreviewRuntimeId(): string | null {
  return runtimeId;
}

function bootRuntime(projectId?: string): Promise<PreviewRuntime> {
  booting ??= loadWebcontainers()
    .then((wc) => {
      const id = previewRuntimeIdOf(projectId);
      runtimeId = id;
      return wc.startPreviewRuntime({
        relayUrl: RELAY_URL, id, attribution: false, php: PREVIEW_PHP_OPTIONS,
        // The .NET bundle on the shared preview host (one URL for every application; the API sends it with CORS).
        dotnet: previewDotnetOptions(RELAY_URL),
        // Read only when per-app origins are on (a test's module mock may not provide it).
        ...previewShieldOptions(RELAY_URL, () => currentProjectId, (template) => wc.previewOriginTemplate(template)),
      });
    })
    .then((runtime) => {
      // The preview's errors and console reach the workspace through the runtime's own
      // channel, attached once for the page (`previewSignals.ts`).
      attachPreviewSignals(runtime);
      setPreviewRunningProbe(() => runtime.listProcesses().length > 0);
      return runtime;
    })
    .catch((error: unknown) => {
      booting = null; // a later Run may retry (the relay was unreachable, say)
      runtimeId = null;
      throw error;
    });
  return booting;
}

/**
 * The shared runtime only if something already booted it — never boots it. A reader of
 * the workspace's files (the knowledge review) offers them only when they exist, rather
 * than spinning up the relay to find an empty file system.
 */
export function peekSharedPreviewRuntime(): Promise<PreviewRuntime> | null {
  return booting;
}

/** Any `node_modules` folder — the root's, or a nested service root's (`/api/node_modules/…`). */
const INSTALLED = /(^|\/)node_modules\//;
const projectReplaceListeners = new Set<(runtime: PreviewRuntime) => void>();

export function onProjectFilesReplacing(listener: (runtime: PreviewRuntime) => void): () => void {
  projectReplaceListeners.add(listener);
  return () => { projectReplaceListeners.delete(listener); };
}

/**
 * Make the runtime hold exactly `files` — this project, now — while keeping what
 * `npm install` put in every `node_modules`, so an unchanged `package.json` does not
 * reinstall (in the root or in a nested service root). One runtime serves the page,
 * so the previous run's files (another project, or files deleted since) go first.
 */
export function replaceProjectFiles(runtime: PreviewRuntime, files: Record<string, string>): void {
  for (const listener of projectReplaceListeners) listener(runtime);
  const stale = runtime.fs.list().filter((path) => !INSTALLED.test(path));
  timeWrite('rm', { fileCount: stale.length, totalBytes: 0 }, () => {
    for (const path of stale) runtime.fs.rm(path);
  });
  timeWrite('writeTree', () => measureFiles(files), () => runtime.writeTree(files));
}
