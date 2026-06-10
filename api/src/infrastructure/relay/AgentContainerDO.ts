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
import type { Env } from '../../env';

export class AgentContainerDO extends Container<Env> {
  /** The container's HTTP server listens here (see api/container/server.mjs). */
  defaultPort = 8080;

  /** Keep the container warm briefly after the last request so a follow-up run on
   *  the same execution reuses the warm process; then it sleeps to stop billing. */
  sleepAfter = '20m';

  /** The agent loop reaches the gateway + GitHub from inside the container. */
  enableInternet = true;

  override onError(error: unknown): unknown {
    // Surface container boot/runtime failures in the Worker logs; the dispatch
    // path treats a failed proxy as "container unavailable" and degrades to the
    // durable executor so the run still completes in the cloud.
    console.error('[AgentContainerDO] container error', error);
    return error;
  }
}
