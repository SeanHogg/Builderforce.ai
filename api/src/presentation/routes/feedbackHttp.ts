/**
 * The HTTP shape of a feedback submit outcome — written once, used by all three
 * inbound doors (the public snippet, the in-app panel and the provider webhooks).
 *
 * Every door calls the SAME engine and therefore gets the same three outcomes back:
 * accepted, refused by the collector's rolling-24h abuse ceiling, or refused by the
 * tenant's monthly plan quota. Mapping those to a status code is presentation work,
 * so it lives here rather than in the engine — but it lives in ONE place rather
 * than in each router, because three hand-written copies is how a caller ends up
 * seeing `429 rate limited` on one channel and `202 accepted` on another for the
 * identical refusal, and a client cannot then tell "come back tomorrow" from
 * "upgrade the plan".
 *
 * 429 for both refusals matches the error-ingest gate (`qualityIngestRoutes`),
 * which is the convention for a CONSUMPTION cap: the request is well-formed and the
 * caller is authorized, there is simply no allowance left this period. 402 is this
 * repo's code for a plan FEATURE the tenant does not have at all (`featureGate` /
 * `planFeatures`) — a different answer, since no amount of waiting earns it. The
 * body carries `quotaExceeded` plus the `effectivePlan / used / limit` triple every
 * consumption gate reports, so a client can say which wall it hit and why.
 */

import type { Context } from 'hono';
import type { HonoEnv } from '../../env';
import type { SubmitQuotaExceeded, SubmitResult } from '../../application/feedback/feedbackEngine';

export type FeedbackSubmitOutcome = SubmitResult | { rateLimited: true } | SubmitQuotaExceeded;

/**
 * Render a submit outcome as the response. `acceptedStatus` differs by door only
 * because it always has: the public snippet answers 202 (queued for a human), the
 * authenticated panel answers 201 (a resource the caller can now see in triage).
 */
export function respondToFeedbackSubmit(
  c: Context<HonoEnv>,
  result: FeedbackSubmitOutcome,
  acceptedStatus: 201 | 202 = 202,
): Response {
  if ('quotaExceeded' in result) {
    return c.json({
      error: 'Monthly feedback submission limit reached for this workspace',
      quotaExceeded: true,
      effectivePlan: result.effectivePlan,
      used: result.used,
      limit: result.limit,
    }, 429);
  }
  if ('rateLimited' in result && result.rateLimited) {
    return c.json({ error: 'Daily feedback limit reached for this collector', rateLimited: true }, 429);
  }
  return c.json(result, acceptedStatus);
}
