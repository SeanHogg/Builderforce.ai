/**
 * The `browser` RunTarget (PRD 31 §W9) — the blueprint's services run in this tab on
 * our WebContainers application runtime: Node services on the `node` provider, Python
 * (Pyodide) on `python`, PHP (php-wasm) on `php`, the database as PGlite (persistent,
 * host origin) on the `pglite` provider.
 *
 * It runs on THE page's one preview runtime, holding its lease
 * (`bootSharedPreviewRuntime(owner)`) — never a second instance. So:
 * - at most one application at a time: a new start disposes the previous one first;
 * - starts are SERIALISED (one chain), and each checks after every await that no newer
 *   start has begun since (a generation token) — a superseded start gives up cleanly;
 * - when the workspace takes the runtime, the application is disposed and its session
 *   reads `stopped` (the lease's revocation).
 * It starts only on request (`startsOn: 'request'`): it spends the user's tab.
 * The application runtime itself is loaded on Run, so bundles pay nothing until then.
 */
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import { bootSharedPreviewRuntime, releaseSharedPreviewRuntime, replaceProjectFiles } from '@/lib/browserRuntime/previewRuntime';
import { PREVIEW_PHP_OPTIONS } from '@/lib/browserRuntime/previewPhpOptions';
import { recordedFailure } from '@/lib/reportError';
import { PREVIEW_CAPTURE_SCRIPT } from '@/lib/previewCapture/captureScript';
import { acceptBlueprintInBrowser } from './browserAcceptance';
import { browserRunSession, type BrowserRunHandle } from './browserRunSession';
import type { Acceptance, RunContext, RunStart, RunTarget } from './runTarget';

/** The lease id the run target holds the shared runtime under. */
export const RUN_TARGET_OWNER = 'run-target';

/** Unreadable paths named in a decline before "+N more". */
const UNREADABLE_SHOWN = 5;

/** The application holding the shared runtime, if any. */
let current: BrowserRunHandle | null = null;
/** Bumped by every start; a start whose token is stale has been superseded. */
let generation = 0;
/** Starts run one after another; this is the tail. */
let chain: Promise<unknown> = Promise.resolve();

async function disposeCurrent(): Promise<void> {
  const held = current;
  current = null;
  if (held) await held.session.stop();
}

function unreadableDetail(paths: string[]): string {
  const shown = paths.slice(0, UNREADABLE_SHOWN).join(', ');
  return paths.length > UNREADABLE_SHOWN ? `${shown} (+${paths.length - UNREADABLE_SHOWN})` : shown;
}

async function startSerialised(blueprint: AppBlueprint | null, context: RunContext, token: number): Promise<RunStart> {
  const superseded = (): RunStart => ({ ok: false, code: 'superseded' });
  const accepted = acceptBlueprintInBrowser(blueprint);
  if (!accepted.ok) return accepted;

  const { files, unreadable } = await context.loadFiles();
  if (token !== generation) return superseded();
  if (unreadable.length > 0) return { ok: false, code: 'noFiles', detail: unreadableDetail(unreadable) };
  if (Object.keys(files).length === 0) return { ok: false, code: 'noFiles' };

  const [app, { VirtualFileSystem }] = await Promise.all([
    import('@seanhogg/builderforce-webcontainers/app'),
    import('@seanhogg/builderforce-webcontainers'),
  ]);
  if (token !== generation) return superseded();
  // What only the files tell (a native-only Python package, a PHP extension php-wasm
  // lacks) is judged now, on the loaded files — BEFORE the current run is disposed or the
  // shared runtime is booted and taken from the workspace — so a decline names it and
  // costs nothing, rather than a start that never gets going.
  const projectFiles = new VirtualFileSystem();
  projectFiles.writeTree(files);
  const judged = acceptBlueprintInBrowser(blueprint, projectFiles);
  if (!judged.ok) return judged;

  await disposeCurrent();
  // The capture script belongs to the run: it leaves the preview pages when the run does.
  let booted: { setPreviewScripts(scripts: string[]): void } | null = null;
  const runtime = await bootSharedPreviewRuntime({
    id: RUN_TARGET_OWNER,
    onRevoked: async () => {
      const held = current;
      current = null;
      await held?.revoke();
      booted?.setPreviewScripts([]);
    },
  });
  booted = runtime;
  if (token !== generation) return superseded();
  replaceProjectFiles(runtime, files);
  // Every page the app serves answers the agent's `preview_screenshot` from inside itself.
  runtime.setPreviewScripts([PREVIEW_CAPTURE_SCRIPT]);

  const application = app.startApplicationRuntime(judged.spec, {
    // The runtime the services spawn on: its port policy puts the app's `dependsOn`
    // graph in force while it runs, and its attributed processes end when it stops.
    runtime,
    providers: [
      app.createNodeProvider(runtime),
      app.createPgliteProvider(runtime),
      app.createPythonProvider(runtime, { fs: runtime.fs }),
      // The same PHP options the runtime booted with, and the PHP its processes report.
      app.createPhpProvider(runtime, { fs: runtime.fs, php: PREVIEW_PHP_OPTIONS, platform: runtime.phpPlatform }),
    ],
  });
  const handle = browserRunSession(application, () => {
    if (current !== handle) return;
    current = null;
    runtime.setPreviewScripts([]);
    releaseSharedPreviewRuntime(RUN_TARGET_OWNER);
  });
  current = handle;
  // Not awaited: the session is the surface's view of the start, service by service.
  // A service that fails for good is already on the session (its state and error);
  // anything else is a fault of ours, and recorded.
  void application.start().catch((error: unknown) => {
    if (!(error instanceof app.ApplicationStartError)) recordedFailure('Starting the browser run', undefined)(error);
  });
  return { ok: true, session: handle.session };
}

/** Start in the browser, after any start already under way; a newer start supersedes this one. */
export function startInBrowser(blueprint: AppBlueprint | null, context: RunContext): Promise<RunStart> {
  const token = ++generation;
  const started = chain.then(() => startSerialised(blueprint, context, token));
  // The chain only orders starts; each start's own outcome (or rejection) goes to its caller.
  chain = started.then(() => undefined, () => undefined);
  return started;
}

export const browserRunTarget: RunTarget = {
  id: 'browser',
  startsOn: 'request',
  accepts(blueprint): Acceptance {
    const accepted = acceptBlueprintInBrowser(blueprint);
    return accepted.ok ? { ok: true } : accepted;
  },
  start: startInBrowser,
};
