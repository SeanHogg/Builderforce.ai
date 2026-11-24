/**
 * ONE name, two executors: where a `runtime.*` tool call is answered is decided by
 * WHERE THE APP RUNS (the run target), as data — never by the tool's name.
 * - `browser`   → the browser executor (`browserRuntimeTools`), in the tab that holds the
 *                 run: this one (`activeRun`), or another tab of this origin reached over
 *                 the bridge (`runtimeToolBridge`);
 * - `container` → the server's executor (the built-in tool catalog), over the gateway
 *                 relay — which also answers, plainly, when no target is reachable.
 */
import type { RuntimeToolId } from '@builderforce/creation-canvas-contract';
import { callBuiltinTool } from '@/lib/builtinTools';
import { peekSharedPreviewRuntime, sharedPreviewRuntimeOwner } from '@/lib/browserRuntime/previewRuntime';
import { activeRunFor, type ActiveRun } from '../activeRun';
import { RUN_TARGET_OWNER } from '../browserRunTarget';
import type { RunTargetId } from '../runTarget';
import { defaultBrowserToolDeps, runBrowserRuntimeTool } from './browserRuntimeTools';
import { askRuntimeTools, serveRuntimeTools, type BridgeAnswer } from './runtimeToolBridge';

// The Brain's host hook lives in the light `runtimeToolRoute` (it loads this module on call).
export { isRuntimeTool, localRuntimeToolRouter } from './runtimeToolRoute';

type Json = Record<string, unknown>;

export interface RuntimeToolRoutes {
  activeRunFor(projectId: string): ActiveRun | undefined;
  /** Another tab holding the browser run, if one answers. */
  ask(tool: RuntimeToolId, args: Json): Promise<BridgeAnswer>;
  /** The executor per run target. `container` also serves "no run reachable from here". */
  executors: Record<RunTargetId, (tool: RuntimeToolId, args: Json, run: ActiveRun | undefined) => Promise<unknown>>;
}

/** The server's executor, through the gateway relay the Brain's tools already use. */
export function callServerRuntimeTool(tool: RuntimeToolId, args: Json): Promise<unknown> {
  return callBuiltinTool(tool, args);
}

/** The browser executor over THIS tab's runtime. */
export function executeInThisTab(run: ActiveRun, tool: RuntimeToolId, args: Json): Promise<unknown> {
  return runBrowserRuntimeTool(run, tool, args, defaultBrowserToolDeps(
    peekSharedPreviewRuntime,
    () => sharedPreviewRuntimeOwner() === RUN_TARGET_OWNER,
  ));
}

export const DEFAULT_ROUTES: RuntimeToolRoutes = {
  activeRunFor,
  ask: (tool, args) => askRuntimeTools(tool, args),
  executors: {
    browser: (tool, args, run) => executeInThisTab(run!, tool, args),
    container: (tool, args) => callServerRuntimeTool(tool, args),
  },
};

/** Answer a `runtime.*` call on the executor of the target the app runs on. */
export async function executeRuntimeTool(tool: RuntimeToolId, args: Json, routes: RuntimeToolRoutes = DEFAULT_ROUTES): Promise<unknown> {
  const run = routes.activeRunFor(String(args.projectId ?? ''));
  if (run) return routes.executors[run.session.targetId](tool, args, run);
  const elsewhere = await routes.ask(tool, args);
  if (elsewhere.answered) return elsewhere.result;
  return routes.executors.container(tool, args, undefined);
}

let serving = 0;
let stopServing: (() => void) | null = null;

/**
 * Answer other tabs' runtime tool calls for the runs this tab holds — while any preview
 * in this tab wants it (counted). Returns the release.
 */
export function serveRuntimeToolsFromThisTab(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  if (serving++ === 0) stopServing = serveRuntimeTools({ execute: executeInThisTab });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--serving === 0) { stopServing?.(); stopServing = null; }
  };
}
