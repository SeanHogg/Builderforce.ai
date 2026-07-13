/**
 * QaRunnerContainerDO — the managed Cloudflare Container that runs the Agentic
 * Tester (browser exploration). Mirrors {@link AgentContainerDO} but backs the
 * Playwright runner image (api/qa-container) instead of the code-agent image.
 *
 * The platform's scheduled sweep (runQaExplorationSweep) enqueues a
 * `qa_explorations` row, mints a short-lived tenant-scoped token, and proxies
 * `POST /run` to this container. The container claims + drives the exploration
 * and posts findings straight back to the public API — so there's no callback
 * channel and no DB credentials in the container.
 *
 * Bound in wrangler.toml as `QA_RUNNER_CONTAINER` (a `[[containers]]` block).
 * One instance per exploration (`idFromName('qa-exec:<explorationId>')`).
 */
import { Container } from '@cloudflare/containers';
import type { Env } from '../../env';

export class QaRunnerContainerDO extends Container<Env> {
  /** The container's HTTP server listens here (see qa-e2e/src/server.ts). */
  defaultPort = 8080;

  /** Keep warm briefly after a run so a follow-up exploration reuses the warm
   *  browser process, then sleep to stop billing. */
  sleepAfter = '10m';

  /** The runner reaches the public API + the site-under-test from the container. */
  enableInternet = true;

  override async onError(error: unknown): Promise<unknown> {
    console.error('[QaRunnerContainerDO] container error', error);
    return error;
  }
}
