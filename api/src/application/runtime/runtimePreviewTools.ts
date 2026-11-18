/**
 * The CONTAINER executor of the run loop's `runtime.*` agent tools (PRD 31 §W1 item 8).
 * The tools are defined once (`RUNTIME_TOOLS`, creation-canvas-contract); this answers
 * them server-side for an app running in a cloud-run container, over the helpers that
 * exist: the preview lease and mint (`previewSessions` / `previewDevServer`), Browser
 * Rendering (`captureWebScreenshot`), the preview's control routes and the run sandbox
 * (`containerPreviewControl`).
 *
 * The gates, in order: the project is the caller's; an ad-hoc `run_verify` command needs
 * developer or above (anyone may run the app's DECLARED verify commands); the plan
 * includes `livePreview`; a named execution's preview belongs to THIS project. Output
 * that came out of the container is scrubbed of the project's secret values.
 *
 * The other executor runs in the user's tab (the browser run target). A server-side
 * caller cannot reach a tab, so when no container holds a preview the answer is
 * `BROWSER_RUN_NOT_ATTACHED` with what to do instead — never a wait.
 */
import {
  BROWSER_RUN_NOT_ATTACHED,
  RUNTIME_LOG_LINES,
  VERIFY_OUTPUT_TAIL_CHARS,
  type RuntimeToolId,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { TenantRole } from '../../domain/shared/types';
import { mintPreviewForExecution } from './previewDevServer';
import { loadPreviewSession, loadProjectPreviewSession, type PreviewSessionRow } from './previewSessions';
import { postPreviewControl, runVerifyInSandbox, runWithinBudget, type VerifyRun } from './containerPreviewControl';
import { captureWebScreenshot, isScreenshotViewport, ScreenshotUnavailableError } from '../web/webScreenshot';
import { getLatestBlueprint } from '../blueprint/blueprintDetection';
import { projectInTenant } from '../project/projectOwnership';
import { loadProjectSecretValues, redactSecretValues } from '../secrets/projectSecrets';
import { tenantHasFeature } from '../tenant/featureEntitlements';

type Json = Record<string, unknown>;

export interface RuntimeToolCaller {
  env: Env;
  db: Db;
  tenantId: number;
  userId?: string | null;
  role?: TenantRole;
  /** The caller is an agent (a cloud run), which runs at developer level. */
  isAgent?: boolean;
}

/** The collaborators, injectable so the routing and gates are testable without a container. */
export interface ContainerRuntimeDeps {
  projectInTenant: typeof projectInTenant;
  hasLivePreview(caller: RuntimeToolCaller): Promise<boolean>;
  loadPreviewSession: typeof loadPreviewSession;
  loadProjectPreviewSession: typeof loadProjectPreviewSession;
  mintPreviewForExecution: typeof mintPreviewForExecution;
  captureWebScreenshot: typeof captureWebScreenshot;
  getLatestBlueprint: typeof getLatestBlueprint;
  secretValues(caller: RuntimeToolCaller, projectId: number): Promise<Record<string, string>>;
  runInSandbox(env: Env, executionId: number, command: string, timeoutMs: number): Promise<VerifyRun>;
  previewControl: typeof postPreviewControl;
  verifyBudgetMs?: number;
}

const DEFAULT_DEPS: ContainerRuntimeDeps = {
  projectInTenant,
  hasLivePreview: (caller) => tenantHasFeature(caller.env, caller.tenantId, caller.userId ?? null, 'livePreview'),
  loadPreviewSession,
  loadProjectPreviewSession,
  mintPreviewForExecution,
  captureWebScreenshot,
  getLatestBlueprint,
  secretValues: (caller, projectId) => loadProjectSecretValues(caller.db, caller.env, caller.tenantId, projectId),
  runInSandbox: runVerifyInSandbox,
  previewControl: postPreviewControl,
};

/** Roles that may run a command of their own choosing in the container. */
const AD_HOC_ROLES: ReadonlySet<TenantRole> = new Set([TenantRole.OWNER, TenantRole.MANAGER, TenantRole.DEVELOPER]);

/** Lease statuses whose container no longer holds the preview. */
const GONE: ReadonlySet<PreviewSessionRow['status']> = new Set(['stopped', 'idle_evicted']);

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const tail = (text: string, chars: number): string => (text.length > chars ? `…${text.slice(-chars)}` : text);

/** The answer when no container holds a preview: the app, if it runs, runs in a tab. */
export function browserRunNotAttached(detail?: string): Json {
  return {
    ok: false,
    code: BROWSER_RUN_NOT_ATTACHED,
    target: null,
    reason:
      'No cloud container is holding a preview of this app'
      + (detail ? ` (${detail})` : '')
      + ". If it runs in the browser tier, it runs in the user's own tab, which this run cannot reach. "
      + 'Ask the user to open the project and press "Run in your browser" in its preview; while that tab is open, '
      + 'the browser agent answers these tools there.',
  };
}

function mayRunAdHoc(caller: RuntimeToolCaller): boolean {
  if (caller.role) return AD_HOC_ROLES.has(caller.role);
  return caller.isAgent === true;
}

async function verifyCommands(deps: ContainerRuntimeDeps, env: Env, projectId: number, args: Json): Promise<string[]> {
  if (typeof args.command === 'string' && args.command.trim()) return [args.command.trim()];
  const blueprint = await deps.getLatestBlueprint(env, projectId);
  return [...new Set((blueprint?.services ?? []).map((s) => s.verifyCommand?.trim() ?? '').filter(Boolean))];
}

async function containerTool(
  caller: RuntimeToolCaller, deps: ContainerRuntimeDeps, tool: RuntimeToolId,
  projectId: number, lease: PreviewSessionRow, args: Json,
): Promise<Json> {
  const executionId = lease.executionId;
  const base = { target: 'container', executionId };
  const scrub = async () => {
    const secrets = await deps.secretValues(caller, projectId);
    return (text: string) => redactSecretValues(text, secrets);
  };

  if (tool === 'runtime.preview_logs') {
    const lines = Math.min(num(args.lines) ?? RUNTIME_LOG_LINES.default, RUNTIME_LOG_LINES.max);
    const reply = await deps.previewControl(caller.env, executionId, '/sandbox/preview/logs', { lines });
    if (!reply.ok) return { ok: false, ...base, reason: `The container has no dev-server output to read (${reply.error ?? 'unknown'}).` };
    const clean = await scrub();
    const out = Array.isArray(reply.lines) ? reply.lines.map((line) => clean(String(line))) : [];
    return { ok: true, ...base, running: reply.running === true, exitCode: reply.exitCode ?? null, lines: out };
  }
  if (tool === 'runtime.preview_restart') {
    const reply = await deps.previewControl(caller.env, executionId, '/sandbox/preview/restart');
    return reply.ok
      ? { ok: true, ...base, restarted: true, note: 'The dev server is restarting; call preview_status to see it come back.' }
      : { ok: false, ...base, restarted: false, reason: `The container could not restart the dev server (${reply.error ?? 'unknown'}).` };
  }
  if (tool === 'runtime.run_verify') {
    const commands = await verifyCommands(deps, caller.env, projectId, args);
    if (commands.length === 0) return { ok: false, ...base, reason: 'The app declares no verify command; pass `command` to run one.' };
    const ran = await runWithinBudget(commands, (command, timeoutMs) => deps.runInSandbox(caller.env, executionId, command, timeoutMs), deps.verifyBudgetMs);
    const clean = await scrub();
    const results = ran.map((r) => ('skipped' in r
      ? { command: r.command, ok: false, skipped: true, reason: 'the verify time budget ran out before this command' }
      : { command: r.command, ok: r.result.ok && r.result.exitCode === 0, exitCode: r.result.exitCode ?? null, output: clean(tail(r.result.stdout ?? r.result.error ?? '', VERIFY_OUTPUT_TAIL_CHARS)) }));
    return { ok: results.every((r) => r.ok), ...base, results };
  }

  // Status, URL and screenshot need a link that loads — the mint proves the dev server answers.
  const mint = await deps.mintPreviewForExecution(caller.env, caller.db, caller.tenantId, executionId);
  if (!mint.available) {
    return tool === 'runtime.preview_status'
      ? { ...base, ok: true, live: false, status: 'unavailable', detail: mint.detail ?? null, declined: [] }
      : { ok: false, ...base, reason: `The container's dev server is not answering${mint.detail ? ` (${mint.detail})` : ''}; read preview_logs.` };
  }
  switch (tool) {
    case 'runtime.preview_status':
      return {
        ok: true, ...base, live: true, status: mint.status, url: mint.url, expiresInSeconds: mint.expiresInSeconds,
        services: [{ id: 'app', state: mint.status === 'starting' ? 'starting' : 'live', url: mint.url }],
        declined: [],
      };
    case 'runtime.preview_url':
      return { ok: true, ...base, serviceId: 'app', url: mint.url, expiresInSeconds: mint.expiresInSeconds };
    default: {
      try {
        const viewport = isScreenshotViewport(args.viewport) ? args.viewport : 'desktop';
        const shot = await deps.captureWebScreenshot(caller.env, mint.url, { viewport });
        return { ok: true, ...base, imageDataUrl: shot.imageDataUrl, width: shot.width, height: shot.height, viewport: shot.viewport, capturedAt: shot.capturedAt };
      } catch (error) {
        if (error instanceof ScreenshotUnavailableError) return { ok: false, ...base, code: error.reason, reason: error.message };
        throw error;
      }
    }
  }
}

/** Answer one `runtime.*` tool for an app in a container, or say why it cannot be answered here. */
export async function runContainerRuntimeTool(
  caller: RuntimeToolCaller, tool: RuntimeToolId, args: Json, deps: ContainerRuntimeDeps = DEFAULT_DEPS,
): Promise<Json> {
  const projectId = num(args.projectId);
  if (projectId == null) return { ok: false, error: 'projectId must be a positive integer' };
  if (!(await deps.projectInTenant(caller.db, caller.tenantId, projectId))) {
    return { ok: false, error: 'Project not found in this workspace', projectId };
  }
  if (tool === 'runtime.run_verify' && typeof args.command === 'string' && args.command.trim() && !mayRunAdHoc(caller)) {
    return {
      ok: false, code: 'forbidden',
      error: "Running a command of your own needs the developer role or above; run_verify without `command` runs the app's declared verify commands.",
    };
  }
  if (!(await deps.hasLivePreview(caller))) {
    return {
      ok: false, code: 'plan_limit', target: null,
      reason: "Live preview in a cloud container is not included in this workspace's plan. The free browser tier runs in the user's tab: ask them to open the project and press \"Run in your browser\".",
    };
  }
  const executionId = num(args.executionId);
  const lease = executionId != null
    ? await deps.loadPreviewSession(caller.db, caller.tenantId, executionId)
    : await deps.loadProjectPreviewSession(caller.db, caller.tenantId, projectId);
  if (lease && lease.projectId !== projectId) {
    return { ok: false, error: 'That run does not belong to this project.', projectId, executionId };
  }
  if (!lease || GONE.has(lease.status)) {
    const notAttached = browserRunNotAttached(lease?.detail ?? undefined);
    return tool === 'runtime.preview_status'
      ? { ...notAttached, ok: true, live: false, declined: [{ targetId: 'container', code: 'noContainerPreview', ...(lease?.detail ? { detail: lease.detail } : {}) }] }
      : notAttached;
  }
  return containerTool(caller, deps, tool, projectId, lease, args);
}
