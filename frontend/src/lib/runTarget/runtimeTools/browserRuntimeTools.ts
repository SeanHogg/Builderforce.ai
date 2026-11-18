/**
 * The BROWSER executor of the run loop's `runtime.*` agent tools (PRD 31 §W1 item 8,
 * §W9) — the same tools the server answers for a container (`RUNTIME_TOOLS`), answered
 * in the tab that holds the browser run, from its `RunSession`: status/url/logs/restart
 * through the session, the screenshot through the page's own capture script
 * (`previewCapture`), verify on the run's runtime (bounded, killed at its deadline).
 * Whatever acts on the runtime first checks the run still HOLDS it — after the editor
 * took it over, the run is stopped and says so.
 */
import {
  CANVAS_VIEWPORTS,
  RUNTIME_LOG_LINES,
  VERIFY_OUTPUT_TAIL_CHARS,
  type CanvasViewport,
  type RuntimeToolId,
} from '@builderforce/creation-canvas-contract';
import type { PreviewRuntime } from '@seanhogg/builderforce-webcontainers';
import { capturePreview, type PreviewCapture } from '@/lib/previewCapture/capturePreview';
import { commandOf, runtimeRoot } from '../blueprintToApplicationSpec';
import type { ActiveRun } from '../activeRun';
import { readLogTail } from './logTail';

type Json = Record<string, unknown>;

export interface BrowserToolDeps {
  capture(url: string, viewport: CanvasViewport): Promise<PreviewCapture>;
  /** The run's runtime (already booted by the run). */
  runtime(): Promise<PreviewRuntime> | null;
  /** Whether the run still holds the runtime (the editor may have taken it). */
  ownsRuntime(): boolean;
  /** Log read timings (tests shorten them). */
  logIdleMs?: number;
  /** Verify: per-command and total budgets (tests shorten them). */
  verifyCommandMs?: number;
  verifyBudgetMs?: number;
}

/** A verify command is killed at this point. */
export const VERIFY_COMMAND_MS = 120_000;
/** All verify commands of one call together. */
export const VERIFY_BUDGET_MS = 300_000;

const STOPPED_REASON = 'The browser run was stopped: the editor took over the browser runtime. Press "Run in your browser" again.';

const tail = (text: string, chars: number): string => (text.length > chars ? `…${text.slice(-chars)}` : text);

function pickService(run: ActiveRun, args: Json): string | undefined {
  if (typeof args.serviceId === 'string' && args.serviceId.trim()) return args.serviceId.trim();
  return run.session.services().find((service) => service.previewable)?.id;
}

/** The root an ad-hoc command runs in: the named service's, else the app's primary service's. */
function rootFor(run: ActiveRun, args: Json): string {
  const services = run.blueprint?.services ?? [];
  const named = typeof args.serviceId === 'string' ? services.find((s) => s.id === args.serviceId) : undefined;
  const service = named ?? services.find((s) => s.isPrimary) ?? services[0];
  return runtimeRoot(service?.rootDir);
}

async function readAll(stream: ReadableStream<string>): Promise<string> {
  let text = '';
  await stream.pipeTo(new WritableStream({ write: (chunk) => { text = tail(text + chunk, VERIFY_OUTPUT_TAIL_CHARS * 2); } }));
  return text;
}

async function runOne(runtime: PreviewRuntime, line: string, root: string, timeoutMs: number): Promise<Json> {
  const command = commandOf(line);
  if (!command) return { command: line, ok: false, reason: 'nothing to run' };
  const process = runtime.run(command.command, command.args, { cwd: root });
  const output = readAll(process.combinedOutput);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
  const outcome = await Promise.race([process.wait(), deadline]);
  clearTimeout(timer);
  if (outcome === 'timeout') {
    process.kill('SIGKILL');
    return { command: line, ok: false, timedOut: true, output: tail(await output, VERIFY_OUTPUT_TAIL_CHARS) };
  }
  return { command: line, ok: outcome === 0, exitCode: outcome, output: tail(await output, VERIFY_OUTPUT_TAIL_CHARS) };
}

async function runVerify(run: ActiveRun, args: Json, deps: BrowserToolDeps): Promise<Json> {
  const declared = (run.blueprint?.services ?? [])
    .filter((service) => service.verifyCommand?.trim())
    .map((service) => ({ line: service.verifyCommand!.trim(), root: runtimeRoot(service.rootDir) }));
  const commands = typeof args.command === 'string' && args.command.trim()
    ? [{ line: args.command.trim(), root: rootFor(run, args) }]
    : declared.filter((c, i) => declared.findIndex((d) => d.line === c.line && d.root === c.root) === i);
  if (commands.length === 0) return { ok: false, target: 'browser', reason: 'The app declares no verify command; pass `command` to run one.' };
  const booting = deps.runtime();
  if (!booting) return { ok: false, target: 'browser', reason: 'The browser runtime is not running in this tab.' };
  const runtime = await booting;
  const deadline = Date.now() + (deps.verifyBudgetMs ?? VERIFY_BUDGET_MS);
  const results: Json[] = [];
  for (const { line, root } of commands) {
    const left = deadline - Date.now();
    if (left < 1_000) { results.push({ command: line, ok: false, skipped: true, reason: 'the verify time budget ran out before this command' }); continue; }
    results.push(await runOne(runtime, line, root, Math.min(left, deps.verifyCommandMs ?? VERIFY_COMMAND_MS)));
  }
  return { ok: results.every((r) => r.ok), target: 'browser', results };
}

/** Answer one `runtime.*` tool from the browser run this tab holds. */
export async function runBrowserRuntimeTool(run: ActiveRun, tool: RuntimeToolId, args: Json, deps: BrowserToolDeps): Promise<Json> {
  const base = { target: 'browser' as const };
  const { session } = run;
  const acting = tool === 'runtime.preview_restart' || tool === 'runtime.run_verify' || tool === 'runtime.preview_screenshot';
  if (acting && !deps.ownsRuntime()) return { ok: false, ...base, stopped: true, reason: STOPPED_REASON };
  switch (tool) {
    case 'runtime.preview_status':
      return {
        ok: true, ...base, holdsRuntime: deps.ownsRuntime(),
        services: session.services().map((s) => ({ id: s.id, state: s.state, ...(s.url ? { url: s.url } : {}), ...(s.error ? { error: s.error } : {}) })),
        declined: run.declined,
      };
    case 'runtime.preview_url': {
      const serviceId = pickService(run, args);
      const url = serviceId ? session.url(serviceId) : undefined;
      return url ? { ok: true, ...base, serviceId, url } : { ok: false, ...base, serviceId: serviceId ?? null, reason: 'The service is not serving a page yet.' };
    }
    case 'runtime.preview_logs': {
      const serviceId = typeof args.serviceId === 'string' && args.serviceId.trim() ? args.serviceId.trim() : undefined;
      const lines = Math.min(Math.max(1, Number(args.lines) || RUNTIME_LOG_LINES.default), RUNTIME_LOG_LINES.max);
      const read = await readLogTail(session.logs(serviceId), lines, { idleMs: deps.logIdleMs });
      return { ok: true, ...base, serviceId: serviceId ?? null, lines: read.map((l) => (serviceId ? l.text : `[${l.serviceId}] ${l.text}`)) };
    }
    case 'runtime.preview_restart': {
      const serviceId = pickService(run, args);
      if (!serviceId) return { ok: false, ...base, reason: 'The app has no service to restart.' };
      await session.restart(serviceId);
      const after = session.services().find((s) => s.id === serviceId);
      return { ok: after?.state !== 'failed', ...base, restarted: true, serviceId, state: after?.state ?? null, ...(after?.error ? { error: after.error } : {}) };
    }
    case 'runtime.preview_screenshot': {
      const serviceId = pickService(run, args);
      const url = serviceId ? session.url(serviceId) : undefined;
      if (!url) return { ok: false, ...base, reason: 'The service is not serving a page yet.' };
      const viewport = (CANVAS_VIEWPORTS as readonly string[]).includes(String(args.viewport)) ? (args.viewport as CanvasViewport) : 'desktop';
      try {
        const shot = await deps.capture(url, viewport);
        return { ok: true, ...base, serviceId, viewport, imageDataUrl: shot.imageDataUrl, width: shot.width, height: shot.height, capturedAt: new Date().toISOString() };
      } catch (error) {
        return { ok: false, ...base, serviceId, reason: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'runtime.run_verify':
      return runVerify(run, args, deps);
  }
}

export function defaultBrowserToolDeps(runtime: BrowserToolDeps['runtime'], ownsRuntime: BrowserToolDeps['ownsRuntime']): BrowserToolDeps {
  return { capture: capturePreview, runtime, ownsRuntime };
}
