/**
 * ASKING A LIVE ADDRESS WHETHER IT IS SERVING — the adapter behind `DeploymentProbe`.
 *
 * ── WHY THIS IS A SEPARATE FILE ──────────────────────────────────────────────────
 * `stageChecks.ts` is the gate, and the gate is assertable in CI precisely because it
 * does no I/O: the deployment runner takes a port and this implements it. Putting the
 * fetch inside the runner would have made the one check that matters most for a
 * hosted listing the one check no test could pin.
 *
 * ── WHY IT DOES NOT FETCH ────────────────────────────────────────────────────────
 * It has no `fetch` of its own, on purpose. "Ask a URL, accept only a 2xx, and
 * require a marker in the body" is a rule the platform owns exactly once, in
 * `monitoring/httpCheck.ts` — the same rule the five-minute monitor sweep evaluates
 * and the same one `watchDeployedBackend` configures for every self-hosted backend.
 * It is the rule that knows a deleted Lambda still answers 200 from an edge while a
 * healthy load balancer answers 503 for a Cloud Run revision that never started. A
 * second copy here would agree with it until the day one of them changed.
 *
 * So every assertion this probe makes is put THROUGH that primitive:
 *
 *   root    `GET /`            any 2xx. Is anything at all being served.
 *   health  `GET <healthPath>` 2xx AND the engine's own marker in the body, which is
 *                              the only evidence the BACKEND — not an edge, not a
 *                              parked page — is the thing replying.
 *
 * A real monitor IS still created — at publish time, not at stage time, by
 * `watchHostedListing` below, so a hosted listing that goes on sale is watched from
 * the moment it does. Stage itself writes nothing: it is a point-in-time question
 * asked for a seller watching a spinner, and answering it by storing a `sev2` monitor
 * would page an on-call engineer for a half-finished app.
 */

import { BACKEND_HEALTH_MARKER, BACKEND_HEALTH_PATH } from '../backend/adapters/handlerEngineSource';
import { MonitoringService } from '../monitoring/MonitoringService';
import { httpCheck } from '../monitoring/httpCheck';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Db } from '../../infrastructure/database/connection';
import type { DeploymentProbe, DeploymentProbeResult } from './stageChecks';

/** `https://x.example/` → `https://x.example`, so joining a path cannot double a slash. */
function origin(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * The substring that says a STATIC HOST answered, rather than a backend.
 *
 * ── WHY DISTINGUISHING THESE MATTERS ─────────────────────────────────────────────
 * "2xx at the readiness route without the engine's marker" has two completely
 * different causes and they need opposite verdicts:
 *
 *   an edge, proxy or parked page answering FOR a backend that is gone   → BLOCK
 *   a static host serving its index page for every unknown path          → absent
 *
 * A single strict `bodyMatch` cannot tell them apart, and guessing either way is a
 * real cost: guess "block" and every working static site is refused; guess "absent"
 * and the exact failure this harness exists to catch walks through. So the readiness
 * route is asked three ways — for the engine's marker, for a page, and for its status
 * alone — and the three answers name the cause between them.
 */
const STATIC_PAGE_MARKER = '<html';

/**
 * The probe Stage and publish both use.
 *
 * Every request goes out together: they are independent, they all hit one origin, and
 * a hosted listing is staged by a person watching a spinner.
 */
export function deploymentProbe(): DeploymentProbe {
  return async (address: string): Promise<DeploymentProbeResult> => {
    const base = origin(address);
    // Not an https address at all. Nothing to ask, and nothing worth selling access
    // to over http — the same test `liveUrl` applies when it reads the snapshot.
    if (!/^https:\/\//i.test(base)) return { url: address, root: 'breach', health: 'unknown' };

    const healthUrl = `${base}${BACKEND_HEALTH_PATH}`;
    const [root, engine, page, answered] = await Promise.all([
      httpCheck({ url: `${base}/` }),
      httpCheck({ url: healthUrl, bodyMatch: BACKEND_HEALTH_MARKER }),
      httpCheck({ url: healthUrl, bodyMatch: STATIC_PAGE_MARKER }),
      httpCheck({ url: healthUrl }),
    ]);

    return {
      url: base,
      root,
      health:
        engine === 'ok' ? 'ok'
        // A page where a JSON readiness reply belongs: this deployment has no
        // generated backend and the host is serving its index for any path.
        : page === 'ok' ? 'unknown'
        // Answered 2xx, is not a page, and is not the engine. Something is replying
        // on the backend's behalf while the backend is not there — the precise case
        // a status code alone reports as healthy.
        : answered === 'ok' ? 'breach'
        // 404, 5xx or unreachable: there is no readiness route here to ask.
        : 'unknown',
    };
  };
}

/**
 * Put a hosted listing's address under the platform's standing watch.
 *
 * ── WHY AT PUBLISH AND NOT AT STAGE ──────────────────────────────────────────────
 * Stage asks once, for the seller. This is the OTHER half of the same fact: once
 * strangers are paying for access, "is it still serving" has to keep being asked, and
 * `runMonitorSweep` already asks every five minutes, opens an incident on breach and
 * pages on-call. A hosted listing that went live and was never watched is precisely
 * how a subscriber becomes the monitoring.
 *
 * `watchDeployedBackend` is idempotent per project, so re-publishing re-points the
 * existing monitor rather than accumulating one per release. Best-effort: a
 * monitoring failure must never refuse a publish that has already been checked.
 */
export async function watchHostedListing(
  db: Db,
  input: { tenantId: number; projectId: number; projectName: string; deployedUrl: string },
): Promise<void> {
  try {
    await new MonitoringService(db).watchDeployedBackend(input.tenantId, {
      projectId: input.projectId,
      projectName: input.projectName,
      deployedUrl: origin(input.deployedUrl),
      healthPath: BACKEND_HEALTH_PATH,
    });
  } catch (cause) {
    // Never rethrown: the listing is live and its address was just checked, and a
    // monitor that failed to register is a gap in observability rather than a reason
    // to un-sell a product a buyer may already be looking at. Reported, though —
    // a hosted listing quietly going unwatched is exactly the failure this seam is
    // for, and swallowing it silently would make it invisible.
    reportCaughtError(cause, {
      source: 'marketplace',
      operation: 'watchHostedListing',
      level: 'warning',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
  }
}
