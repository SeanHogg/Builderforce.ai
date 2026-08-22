import { createDurableErrorReporter, type DurableErrorReporter } from '../../application/observability/durableErrorReporter';
/**
 * AgentContainerDO — the **long-lived Cloudflare Container** runtime for a
 * "Cloud Agent (Node/Container)". Unlike {@link CloudRunnerDO} (the durable
 * surface, one LLM step per alarm tick, no shell), this runs the agent loop in a
 * persistent Node process inside a real container, so the agent gets a **real
 * shell** (`run_command`) to clone the repo, install deps, and run actual
 * builds/tests/lint — and can run continuously for very long tasks without the
 * per-tick overhead.
 *
 * The container image (api/container) boots a small HTTP server; this DO is the
 * Cloudflare-Containers control plane that starts/stops that container and proxies
 * the run request to it. The container drives the loop and calls back into the
 * Worker's internal container-op endpoint for every LLM step, repo telemetry, and
 * the final PR — so the Worker stays the single source of truth for the gateway,
 * usage metering, and PR finalize (no duplicated loop logic, no leaked DB creds).
 *
 * Bound in wrangler.toml as `AGENT_CONTAINER` (a `[[containers]]` block backed by
 * this class). One instance per execution (`idFromName('exec:<id>')`).
 */
import { Container } from '@cloudflare/containers';
import { buildDatabase } from '../database/connection';
import { handleCloudRunCrash } from '../../application/runtime/cloudSelfHeal';
import { wireExecutionEventSinks } from '../../application/runtime/wireExecutionEventSinks';
import { cloudCrashReason } from '../../application/runtime/orphanReasons';
import { PREVIEW_CONTROL_STOP_PATH } from '../../application/runtime/previewSessions';
import type { Env } from '../../env';

const EXEC_KEY = 'executionId';

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

  /** The agent loop reaches the gateway + GitHub from inside the container. */
  enableInternet = true;

  /**
   * Capture the executionId off the `/run` proxy so {@link onError} can attribute a
   * hard container death (OOM / evicted / unbootable image) to the right run — the
   * DO id name (`exec:<id>`) is one-way, so we stash it in DO storage. Best-effort;
   * never blocks the proxied request.
   */
  override async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      // Idle-preview eviction. Terminal, and handled BEFORE the container proxy so it
      // never reaches the image: the point is to release the INSTANCE, and a request
      // forwarded into the container would only keep it alive.
      if (request.method === 'POST' && url.pathname === PREVIEW_CONTROL_STOP_PATH) {
        await this.stop();
        return new Response(null, { status: 204 });
      }
      if (request.method === 'POST' && url.pathname.endsWith('/run')) {
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
    return super.fetch(request);
  }

  /**
   * The container boot/runtime crashed. Previously this only logged — so a run died
   * silently and the reaper had to GUESS ~90s later. Now we report the REAL reason
   * and recover: self-heal once on the durable executor, else fail the run carrying
   * the actual error. Falls back to a log when the executionId wasn't captured.
   */
  override async onError(error: unknown): Promise<unknown> {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[AgentContainerDO] container error', error);
    try {
      const executionId = await this.ctx.storage.get<number>(EXEC_KEY);
      if (typeof executionId === 'number') {
        // A DO runs in its own isolate and this handler never builds a RuntimeService,
        // so nothing has registered the live-event sinks here. Without this the crash
        // recovery below records telemetry and transitions the run while every open
        // drawer sits on "running" until it polls — the hard-death case that had no
        // live push at all.
        const crashDb = buildDatabase(this.env);
        wireExecutionEventSinks(this.env, crashDb);
        await handleCloudRunCrash(this.env, crashDb, executionId, cloudCrashReason(detail));
      }
    } catch (e) {
      this.reportError(e, { operation: "onError", context: { logMessage: '[AgentContainerDO] crash report failed', details: e } });
    }
    return error;
  }
}
