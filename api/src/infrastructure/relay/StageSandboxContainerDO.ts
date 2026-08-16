/**
 * StageSandboxContainerDO — the disposable Cloudflare Container that boots a
 * staged marketplace snapshot and drives it. Sibling of QaRunnerContainerDO,
 * backing the Playwright runner image at `api/stage-sandbox` instead of
 * `api/qa-container`.
 *
 * `dispatchStageSandbox` mints a run-scoped token and proxies `POST /run` to
 * this container. The container claims its own run (`GET .../claim`), drives
 * it, and posts the result straight back to the public API
 * (`PATCH .../:runId`) — no callback channel and no DB credentials in the
 * container, same shape as the QA runner.
 *
 * Bound in wrangler.toml as `STAGE_SANDBOX_CONTAINER` (a `[[containers]]`
 * block). One instance per run (`idFromName('stage-sandbox:<runId>')`).
 */
import { Container } from '@cloudflare/containers';
import type { Env } from '../../env';

export class StageSandboxContainerDO extends Container<Env> {
  /** The container's HTTP server listens here (see stage-sandbox/server.mjs). */
  defaultPort = 8080;

  /**
   * Shorter than QaRunnerContainerDO's 10m: a Stage Sandbox run is one-shot per
   * unique build (deduped by payload hash), not a repeated per-project sweep,
   * so there is no follow-up run likely to reuse a warm browser process. A
   * short keep-warm window bounds idle billing on what is otherwise a rare,
   * bursty workload.
   */
  sleepAfter = '2m';

  /** The runner reaches the public API from the container to claim its run and
   *  report back. */
  enableInternet = true;

  override async onError(error: unknown): Promise<unknown> {
    console.error('[StageSandboxContainerDO] container error', error);
    return error;
  }
}
