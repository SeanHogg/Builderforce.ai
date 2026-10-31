import { createDurableErrorReporter, type DurableErrorReporter } from '../../application/observability/durableErrorReporter';
/**
 * AgentContainerDO — the control plane of the **run sandbox**: the Cloudflare Container
 * a cloud run's shell and working tree live in (`api/container/server.mjs`).
 *
 * Every cloud run, on every plan, runs ONE engine (`cloudAgentEngine.ts`, ticked by
 * {@link CloudRunnerDO}). This DO starts/stops the container and proxies the engine's
 * `/sandbox/*` calls to it (`application/runtime/sandbox/runSandbox.ts`); the container
 * executes what a Worker cannot — a real shell, a clone, a dev server — and decides
 * nothing. It also serves the web-scan stages and the live-preview passthrough.
 *
 * Bound in wrangler.toml as `AGENT_CONTAINER` (a `[[containers]]` block backed by this
 * class). One instance per execution (`idFromName('exec:<id>')`); web scans and managed
 * hosts use their own names.
 */
import { Container } from '@cloudflare/containers';
import { PREVIEW_CONTROL_STOP_PATH } from '../../application/runtime/previewSessions';
import { decideJobKeepAlive } from '../../application/runtime/sandbox/jobKeepAlive';
import type { Env } from '../../env';

const EXEC_KEY = 'executionId';
/** When the current job keep-alive began (see `jobKeepAlive.ts`); absent = none in effect. */
const KEEPALIVE_SINCE_KEY = 'jobKeepAliveSince';
/** How long the "is a job running?" probe may take. A wedged container process that never answers
 *  must read as "no job", not hold the idle handler open (and renew the timer) forever. */
export const JOB_PROBE_TIMEOUT_MS = 10_000;

export class AgentContainerDO extends Container<Env> {
  /** Bound once here so no call site can forget the runtime override. */
  private readonly reportError: DurableErrorReporter =
    createDurableErrorReporter('infrastructure/relay/AgentContainerDO.ts', this.env, this.ctx);

  /** The container's HTTP server listens here (see api/container/server.mjs). */
  defaultPort = 8080;

  /**
   * Keep the container warm briefly after the last request so a follow-up run on the
   * same execution reuses the warm process; then it sleeps to stop billing.
   *
   * This 20m is sized for a RUN, and deliberately stays that way: a container can sit
   * quiet for minutes inside one `run_command` (an install, a build, a test suite), and
   * a tighter global timer would kill healthy work in progress. A live PREVIEW has the
   * opposite shape — it is watched or it is abandoned — so it is evicted on its own,
   * much tighter policy by the preview sweep (`PREVIEW_IDLE_EVICTION_MS`), which stops
   * this container through {@link PREVIEW_CONTROL_STOP_PATH} below. Two lifetimes,
   * because there are two consumption shapes; one `sleepAfter` cannot express both.
   */
  sleepAfter = '20m';

  /** The sandbox clones from GitHub, installs packages and runs builds from inside the container. */
  enableInternet = true;

  /**
   * Capture the executionId off `/sandbox/open` so {@link onError} can attribute a hard
   * container death (OOM / evicted / unbootable image) to the run it served — the DO id
   * name (`exec:<id>`) is one-way. Best-effort; never blocks the proxied request.
   */
  override async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      // Idle-preview eviction. Terminal, and handled BEFORE the container proxy so it
      // never reaches the image: the point is to release the INSTANCE, and a request
      // forwarded into the container would only keep it alive.
      if (request.method === 'POST' && url.pathname === PREVIEW_CONTROL_STOP_PATH) {
        // A preview stop wins over any job keep-alive: the instance goes, and so does the clock.
        await this.ctx.storage.delete(KEEPALIVE_SINCE_KEY);
        await this.stop();
        return new Response(null, { status: 204 });
      }
      if (request.method === 'POST' && url.pathname === '/sandbox/open') {
        const body = (await request.clone().json().catch(() => null)) as
          { executionId?: number; preview?: { port?: number } } | null;
        if (body && typeof body.executionId === 'number') {
          await this.ctx.storage.put(EXEC_KEY, body.executionId);
        }
        // Hand the image the port the preview passthrough expects. `server.mjs` reads
        // PREVIEW_PORT from its process env at boot, so this MUST be set before the
        // container starts — which is what setting it on the way into the first proxied
        // request achieves. Absent (feature off) ⇒ the passthrough stays inert.
        if (body?.preview && typeof body.preview.port === 'number') {
          this.envVars = { ...(this.envVars ?? {}), PREVIEW_PORT: String(body.preview.port) };
        }
      }
    } catch (error) { /* attribution is best-effort */
      this.reportError(error, { operation: "fetch" });
    }
    // Any request forwarded to the container is real activity: the job keep-alive clock restarts.
    // (The idle probe goes through `containerFetch`, not this method, so it never resets it.)
    // Read first: the clock is almost never set, and a storage write ahead of every proxied
    // request (preview asset traffic included) is not free.
    try {
      if ((await this.ctx.storage.get<number>(KEEPALIVE_SINCE_KEY)) !== undefined) await this.ctx.storage.delete(KEEPALIVE_SINCE_KEY);
    } catch (error) { this.reportError(error, { operation: 'fetch', level: 'warning' }); }
    return super.fetch(request);
  }

  /**
   * The container crashed. The RUN is not lost: the engine owns it, and its next sandbox
   * call reopens a fresh clone of the ticket branch (which carries every committed
   * write) — so this reports, and never fails or re-dispatches the run. Re-dispatching
   * here would start a second engine beside the one still ticking.
   */
  override async onError(error: unknown): Promise<unknown> {
    const executionId = await this.ctx.storage.get<number>(EXEC_KEY).catch(() => undefined);
    this.reportError(error, { operation: "onError", context: { logMessage: '[AgentContainerDO] sandbox container error', details: { executionId } } });
    return error;
  }

  /**
   * The idle timer expired. The default is to stop; this keeps the container for a running
   * BACKGROUND job (a request-less stretch is normal for one), up to the cap in
   * {@link decideJobKeepAlive}. The library renews the timer after this returns, so a
   * kept container is asked again one `sleepAfter` later.
   */
  override async onActivityExpired(): Promise<void> {
    if (!this.ctx.container?.running) return;
    const now = Date.now();
    const since = await this.ctx.storage.get<number>(KEEPALIVE_SINCE_KEY).catch(() => undefined);
    const decision = decideJobKeepAlive(await this.jobRunning(), since, now);
    if (decision.since === null) await this.ctx.storage.delete(KEEPALIVE_SINCE_KEY);
    else if (decision.since !== since) await this.ctx.storage.put(KEEPALIVE_SINCE_KEY, decision.since);
    if (decision.keep) { this.renewActivityTimeout(); return; }
    await this.stop();
  }

  /** Whether the container reports a running background job. Any failure reads "none":
   *  an unreachable container is not one to keep warm. */
  private async jobRunning(): Promise<boolean> {
    try {
      const executionId = await this.ctx.storage.get<number>(EXEC_KEY);
      if (typeof executionId !== 'number') return false;
      const probe = (async () => {
        const res = await this.containerFetch('http://agent-container/sandbox/job/active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ executionId }),
          signal: AbortSignal.timeout(JOB_PROBE_TIMEOUT_MS),
        });
        const body = (await res.json().catch(() => null)) as { active?: unknown } | null;
        return body?.active === true;
      })();
      probe.catch(() => { /* its verdict was already taken, or it timed out */ });
      // The signal alone cannot be trusted to unblock a proxied fetch, so the wait is raced too.
      let timer: ReturnType<typeof setTimeout> | undefined;
      return await Promise.race([
        probe,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('job probe timed out')), JOB_PROBE_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(timer));
    } catch (error) {
      this.reportError(error, { operation: 'jobRunning', level: 'warning' });
      return false;
    }
  }
}
