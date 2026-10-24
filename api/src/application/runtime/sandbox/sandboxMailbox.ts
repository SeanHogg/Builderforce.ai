/**
 * The PULL transport for a run sandbox — for a sandbox that cannot be called.
 *
 * A GitHub Actions runner sits inside the tenant's CI: nothing can open a connection to
 * it. So instead of the engine calling it, the runner long-polls the run's CloudRunnerDO
 * for the engine's next sandbox request and posts the result back. The engine sees the
 * same {@link RunSandbox} either way (`createMailboxSandbox`), and the runner serves the
 * request with the same `sandboxCore.mjs` the container does — one implementation of the
 * primitives, two transports.
 *
 * In-memory by design: it lives in the DO instance whose alarm tick is awaiting the
 * result, and both halves (the engine's await and the runner's poll) reach that same
 * instance (`exec:<id>`). An eviction drops both the waiting tick and the queue; the
 * tick then re-runs from the persisted cursor and re-issues its request.
 */
import { toCheckVerdict, toShellResult, type RunSandbox, type SandboxFsRequest, type SandboxFsResult, type SandboxRunReply } from './runSandbox';

/** One request the runner serves: the same paths the container's HTTP transport answers. */
export interface SandboxMailRequest {
  id: string;
  path: '/sandbox/fs' | '/sandbox/run' | '/sandbox/checks';
  body: Record<string, unknown>;
}

/** What a poll answers: a request to serve, nothing yet, or "stop — the run needs you no longer". */
export type SandboxMailPoll = { request: SandboxMailRequest } | { idle: true } | { close: true };

/** How long one runner poll is held open waiting for a request. */
export const SANDBOX_POLL_HOLD_MS = 25_000;
/** How long a request may wait for its result (a build or test suite can take minutes). */
const RESULT_TIMEOUT_MS = 12 * 60_000;

export class SandboxMailbox {
  private readonly queue: SandboxMailRequest[] = [];
  private readonly pending = new Map<string, (result: unknown) => void>();
  private waiters: Array<() => void> = [];
  private closed = false;
  private seq = 0;

  /** Queue a request and wait for the runner's result (or a timeout / abort). */
  request<T>(path: SandboxMailRequest['path'], body: Record<string, unknown>, signal?: AbortSignal): Promise<T | { ok: false; error: string }> {
    if (this.closed) return Promise.resolve({ ok: false, error: 'the run sandbox is closed' });
    const id = `${Date.now().toString(36)}-${(this.seq++).toString(36)}`;
    return new Promise((resolve) => {
      const done = (result: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(id);
        resolve(result as T | { ok: false; error: string });
      };
      const timer = setTimeout(() => done({ ok: false, error: 'the GitHub Actions runner did not answer in time' }), RESULT_TIMEOUT_MS);
      const onAbort = () => done({ ok: false, error: 'cancelled' });
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, done);
      this.queue.push({ id, path, body });
      this.wake();
    });
  }

  /** The runner's poll: the next request, held open up to `holdMs` for one to arrive. */
  async next(holdMs = SANDBOX_POLL_HOLD_MS): Promise<SandboxMailPoll> {
    if (this.closed) return { close: true };
    if (this.queue.length === 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, holdMs);
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
    if (this.closed) return { close: true };
    const request = this.queue.shift();
    return request ? { request } : { idle: true };
  }

  /** The runner's result for request `id`. False when nothing is waiting for it. */
  resolve(id: string, result: unknown): boolean {
    const done = this.pending.get(id);
    if (!done) return false;
    done(result);
    return true;
  }

  /** The run no longer needs the runner: release every poll and every waiting request. */
  close(): void {
    this.closed = true;
    for (const done of [...this.pending.values()]) done({ ok: false, error: 'the run sandbox is closed' });
    this.queue.length = 0;
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}

/** The engine's {@link RunSandbox} over a mailbox — what a pull-driven runner serves. */
export function createMailboxSandbox(mailbox: SandboxMailbox): RunSandbox {
  return {
    fs: (req: SandboxFsRequest) => mailbox.request<SandboxFsResult>('/sandbox/fs', { ...req }),
    run: async (command: string, signal?: AbortSignal, timeoutMs?: number) =>
      toShellResult(await mailbox.request<SandboxRunReply>('/sandbox/run', { command, ...(timeoutMs ? { timeoutMs } : {}) }, signal)),
    checks: async () => toCheckVerdict(await mailbox.request<unknown>('/sandbox/checks', {})),
    close: async () => { mailbox.close(); },
  };
}
