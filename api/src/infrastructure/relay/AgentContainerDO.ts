/**
 * AgentContainerDO — the **long-lived Cloudflare Container** runtime for a
 * "V2 Cloud Agent (Node/Container)". Unlike {@link CloudRunnerDO} (the durable
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
import { cloudCrashReason } from '../../application/runtime/orphanReasons';
import type { Env } from '../../env';

const EXEC_KEY = 'executionId';

export class AgentContainerDO extends Container<Env> {
  /** The container's HTTP server listens here (see api/container/server.mjs). */
  defaultPort = 8080;

  /** Keep the container warm briefly after the last request so a follow-up run on
   *  the same execution reuses the warm process; then it sleeps to stop billing. */
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
      if (request.method === 'POST' && url.pathname.endsWith('/run')) {
        const body = (await request.clone().json().catch(() => null)) as { executionId?: number } | null;
        if (body && typeof body.executionId === 'number') {
          await this.ctx.storage.put(EXEC_KEY, body.executionId);
        }
      }
    } catch { /* attribution is best-effort */ }
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
        await handleCloudRunCrash(this.env, buildDatabase(this.env), executionId, cloudCrashReason(detail));
      }
    } catch (e) {
      console.error('[AgentContainerDO] crash report failed', e);
    }
    return error;
  }
}
