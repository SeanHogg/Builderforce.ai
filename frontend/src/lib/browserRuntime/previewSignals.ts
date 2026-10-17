/**
 * The ONE channel from the running preview back to the workspace: uncaught errors
 * and console output.
 *
 * The runtime posts both from every page it serves — dev-server pages and HTML a
 * virtual-port server returns alike (`runtime.onError`, `runtime.onPreviewConsole`).
 * That replaced a home-grown bridge (a reporter script injected into the mounted
 * `index.html`, a window `message` listener per workspace) which saw only the one
 * page it was injected into and never saw the console at all.
 *
 * Attached once, when the shared runtime boots (`previewRuntime.ts`). One runtime
 * serves the page, so what it reports belongs to whichever workspace's run is
 * showing — set by {@link setPreviewWorkspace} when a run starts.
 */
import type { PreviewConsoleMessage, PreviewError, PreviewRuntime } from '@seanhogg/builderforce-webcontainers';
import { clearBuildFailures, recordBuildFailure } from '@/lib/buildDiagnostics';
import { clearConsoleEntries, recordConsoleMessage } from '@/lib/previewConsole';
import type { WorkspaceId } from '@/lib/workspace/workspaceId';

/** The surface this module listens on — the whole runtime is not needed, so tests need not fake it. */
export type PreviewSignalSource = Pick<PreviewRuntime, 'url' | 'onError' | 'onPreviewConsole'>;

let current: WorkspaceId | null = null;
const attached = new WeakSet<PreviewSignalSource>();

/**
 * A run of `workspaceId` is starting: what the preview reports from now on is its,
 * and the previous attempt's errors and console are cleared — a run is judged on its
 * own output.
 */
export function setPreviewWorkspace(workspaceId: WorkspaceId): void {
  current = workspaceId;
  clearBuildFailures(workspaceId);
  clearConsoleEntries(workspaceId);
}

/** The workspace the preview's signals currently go to, or null before any run. */
export function previewWorkspace(): WorkspaceId | null {
  return current;
}

/** The page within the preview, relative to the runtime's base: `/`, `/about`. */
function pageOf(href: string, base: string): string | undefined {
  if (!href) return undefined;
  if (href.startsWith(base)) return `/${href.slice(base.length).replace(/^\/+/, '')}`;
  try {
    return new URL(href).pathname;
  } catch {
    return href;
  }
}

/** Error → the build-failure store's runtime shape. */
export function previewFailureFrom(error: PreviewError, base: string) {
  const page = pageOf(error.href, base);
  return {
    source: 'runtime' as const,
    message: error.message,
    ...(error.stack ? { detail: error.stack } : {}),
    ...(page ? { at: `page ${page}` } : {}),
  };
}

/**
 * Route a runtime's preview errors and console into the stores. Idempotent per
 * runtime; returns the detach (the shared runtime never detaches — tests do).
 */
export function attachPreviewSignals(runtime: PreviewSignalSource): () => void {
  if (attached.has(runtime)) return () => {};
  attached.add(runtime);
  const stopErrors = runtime.onError((error: PreviewError) => {
    if (current !== null) recordBuildFailure(current, previewFailureFrom(error, runtime.url));
  });
  const stopConsole = runtime.onPreviewConsole((message: PreviewConsoleMessage) => {
    if (current !== null) recordConsoleMessage(current, message);
  });
  return () => {
    attached.delete(runtime);
    stopErrors();
    stopConsole();
  };
}
