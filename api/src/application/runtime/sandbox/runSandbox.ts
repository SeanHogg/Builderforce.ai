/**
 * THE run sandbox port — the process a cloud run's shell and working tree live in.
 *
 * Every cloud run, on every plan, runs ONE engine: `cloudAgentEngine.ts`, ticked by
 * CloudRunnerDO. A Worker has no process and no disk, so what needs them — `run_command`,
 * the `git_*` tools, a build, a test, a dev server — is executed by a sandbox the engine
 * CALLS. The sandbox decides nothing: it owns no loop, no model choice, no commit and no
 * finalize. That is what the plan used to buy as a separate "container runtime" with its
 * own loop; the plan now decides only what the run is charged.
 *
 * The Cloudflare Container (`api/container/server.mjs`, behind AgentContainerDO) is the
 * one implementation. It is addressed per execution (`exec:<id>`) and answers a request
 * for a clone it does not hold with 409 `not_open` — a recycled instance — so the client
 * re-opens and retries once: the ticket branch already carries every committed write, so
 * a fresh clone IS the run's working tree.
 */
import type { ShellResult } from '@builderforce/agent-tools';
import type { SandboxOpenSpec } from './sandboxOpenSpec';
import { reportedFallback } from '../../observability/caughtErrorReporter';

/** A list / read / write / delete in the sandbox's clone. */
export type SandboxFsRequest =
  | { op: 'list'; path?: string; glob?: string }
  | { op: 'read'; path: string }
  // `committed`: the engine already committed this change to the ticket branch, so the
  // sandbox absorbs it as history (fast-forward) rather than as a working-tree edit.
  | { op: 'write'; path: string; content: string; committed?: boolean }
  | { op: 'delete'; path: string; committed?: boolean };

export interface SandboxFsResult {
  ok: boolean;
  error?: string;
  content?: string;
  paths?: string[];
  truncated?: boolean;
  note?: string;
}

/** A post-edit check verdict: the D1 cascade's code-unit verifier; `steer` is the
 *  failures the model reads under D7. */
export interface SandboxCheckVerdict {
  passed: boolean;
  verifier: string;
  reason?: string;
  steer?: string;
}

export interface RunSandbox {
  fs(req: SandboxFsRequest): Promise<SandboxFsResult>;
  /** A shell command in the clone. `signal` aborting kills it; `timeoutMs` (bounded by the
   *  sandbox's own ceiling) stops it sooner. */
  run(command: string, signal?: AbortSignal, timeoutMs?: number): Promise<ShellResult>;
  /** The project's fast checks over the edits since the last drain — null when nothing
   *  was judged (or the run's levers do not run them). */
  checks(): Promise<SandboxCheckVerdict | null>;
  /** Dispose the clone at run end. Never throws. */
  close(): Promise<void>;
}

/** What `/sandbox/run` answers, on either transport. */
export interface SandboxRunReply { ok: boolean; exitCode?: number; output?: string; timedOut?: boolean; error?: string }

/** A `/sandbox/run` reply as the shared tools read it — ONE mapping for both transports. */
export function toShellResult(r: SandboxRunReply | { ok: false; error: string }): ShellResult {
  if ('exitCode' in r && typeof r.exitCode === 'number') {
    return { ok: r.ok, exitCode: r.exitCode, stdout: r.output ?? '', ...(r.timedOut ? { error: 'the command timed out and was stopped' } : {}) };
  }
  return { ok: false, error: r.error ?? 'the command did not run' };
}

/** A `/sandbox/checks` reply's verdict, or null when nothing was judged — ONE parse for both transports. */
export function toCheckVerdict(r: unknown): SandboxCheckVerdict | null {
  const v = r && typeof r === 'object' ? (r as { verdict?: SandboxCheckVerdict | null }).verdict : null;
  return v && typeof v.passed === 'boolean' ? v : null;
}

/** Just enough of a Durable Object stub to call the sandbox — testable without a binding. */
export interface SandboxTarget {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

const ORIGIN = 'https://agent-container';

/**
 * The container-backed sandbox. `openSpec` is resolved only when the sandbox has to be
 * (re)opened, so a run whose sandbox stays warm never mints a token or reads the repo
 * context again.
 */
export function createContainerSandbox(args: {
  target: SandboxTarget;
  executionId: number;
  openSpec: () => Promise<SandboxOpenSpec | null>;
}): RunSandbox {
  const { target, executionId } = args;
  const post = (path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> =>
    target.fetch(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executionId, ...body }),
      ...(signal ? { signal } : {}),
    });

  const open = async (): Promise<{ ok: boolean; error?: string }> => {
    const spec = await args.openSpec();
    if (!spec) return { ok: false, error: 'this run has no repository the sandbox can clone' };
    const res = await post('/sandbox/open', { ...spec });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return res.ok && body.ok ? { ok: true } : { ok: false, error: body.error ?? `sandbox open answered ${res.status}` };
  };

  /** One call, re-opening once when the instance no longer holds this run's clone
   *  (`reopen: false` for a call a fresh clone could not answer anyway). */
  const call = async <T>(path: string, body: Record<string, unknown>, signal?: AbortSignal, reopen = true): Promise<T | { ok: false; error: string }> => {
    let res = await post(path, body, signal);
    if (res.status === 409 && reopen) {
      const opened = await open();
      if (!opened.ok) return { ok: false, error: `the run sandbox could not be reopened: ${opened.error}` };
      res = await post(path, body, signal);
    }
    const out = (await res.json().catch(() => null)) as T | null;
    return out ?? { ok: false, error: `the run sandbox answered ${res.status}` };
  };

  const failed = (e: unknown): { ok: false; error: string } => ({ ok: false, error: `the run sandbox is unreachable: ${e instanceof Error ? e.message : String(e)}` });

  return {
    fs: (req) => call<SandboxFsResult>('/sandbox/fs', { ...req }).catch(failed),
    run: async (command, signal, timeoutMs) =>
      toShellResult(await call<SandboxRunReply>('/sandbox/run', { command, ...(timeoutMs ? { timeoutMs } : {}) }, signal).catch(failed)),
    // A recycled instance has drained nothing: a fresh clone has no edits to judge.
    checks: async () => toCheckVerdict(await call<unknown>('/sandbox/checks', {}, undefined, false).catch(failed)),
    close: async () => {
      await post('/sandbox/close', {}).catch(reportedFallback(undefined, { source: 'application/runtime/sandbox/runSandbox.ts', operation: 'closeSandbox' }));
    },
  };
}

/** Open the sandbox now (the run's first tick), so the clone and the preview are warming
 *  while the first model turn is in flight. Verdict, never throws. */
export async function openRunSandbox(target: SandboxTarget, spec: SandboxOpenSpec): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await target.fetch(`${ORIGIN}/sandbox/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return res.ok && body.ok ? { ok: true } : { ok: false, error: body.error ?? `sandbox open answered ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
