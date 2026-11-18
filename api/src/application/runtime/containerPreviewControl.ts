/**
 * Reaching a run's container for the `runtime.*` tools: the preview's control routes
 * (`/sandbox/preview/logs`, `/sandbox/preview/restart`, served by `container/server.mjs`
 * over `container/previewProcess.mjs`) and verify commands in the run sandbox
 * (`/sandbox/run`), under ONE time budget so a tool call answers well inside the
 * gateway's request timeout.
 */
import type { Env } from '../../env';
import { createContainerSandbox } from './sandbox/runSandbox';

/** Where the container's control routes answer (the DO stub adds the control secret). */
const CONTAINER_ORIGIN = 'https://agent-container';

/** Total time `run_verify` may spend in the container, across its commands. */
export const VERIFY_BUDGET_MS = 90_000;

export type PreviewControlPath = '/sandbox/preview/logs' | '/sandbox/preview/restart';

export type PreviewControlReply = { ok: boolean; error?: string; [key: string]: unknown };

/** One call to the preview's control surface; a container without the preview answers `no_preview`. */
export async function postPreviewControl(
  env: Env, executionId: number, path: PreviewControlPath, body: Record<string, unknown> = {},
): Promise<PreviewControlReply> {
  const ns = env.AGENT_CONTAINER;
  if (!ns) return { ok: false, error: 'the container binding is unavailable' };
  const stub = ns.get(ns.idFromName(`exec:${executionId}`));
  const res = await stub.fetch(`${CONTAINER_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ executionId, ...body }),
  });
  try {
    return (await res.json()) as PreviewControlReply;
  } catch (error) {
    return { ok: false, error: `the container answered ${res.status} without a readable body (${error instanceof Error ? error.message : String(error)})` };
  }
}

export interface VerifyRun {
  ok: boolean;
  exitCode?: number;
  stdout?: string;
  error?: string;
}

/** One verify command in the run sandbox, stopped at `timeoutMs`. */
export async function runVerifyInSandbox(env: Env, executionId: number, command: string, timeoutMs: number): Promise<VerifyRun> {
  const ns = env.AGENT_CONTAINER;
  if (!ns) return { ok: false, error: 'the container binding is unavailable' };
  // No re-open spec: a verify belongs in the clone the run already holds; a recycled
  // instance has nothing to verify, and says so.
  const sandbox = createContainerSandbox({ target: ns.get(ns.idFromName(`exec:${executionId}`)), executionId, openSpec: async () => null });
  return sandbox.run(command, undefined, timeoutMs);
}

/** Run each command while the budget lasts; the rest are reported as skipped, never silently dropped. */
export async function runWithinBudget<T>(
  commands: string[],
  run: (command: string, timeoutMs: number) => Promise<T>,
  budgetMs: number = VERIFY_BUDGET_MS,
  now: () => number = Date.now,
): Promise<Array<{ command: string; result: T } | { command: string; skipped: true }>> {
  const deadline = now() + budgetMs;
  const out: Array<{ command: string; result: T } | { command: string; skipped: true }> = [];
  for (const command of commands) {
    const left = deadline - now();
    if (left < 1_000) { out.push({ command, skipped: true }); continue; }
    out.push({ command, result: await run(command, left) });
  }
  return out;
}
