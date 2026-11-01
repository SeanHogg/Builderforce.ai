/**
 * The per-recipient delivery rule every campaign channel shares.
 *
 * An email/SMS campaign (`marketing/campaign/send.ts`) and a social campaign
 * (`social/socialCampaignService.ts`) both fan one campaign out into delivery
 * rows — one per recipient, one per connected account — and both had written
 * the same failure rule out longhand, with their own attempt ceiling:
 *
 *   · a RETRYABLE failure (a 429, a provider 5xx) goes back to `queued` so the
 *     next batch or sweep picks it up — burning a recipient on a transient error
 *     is how a campaign silently under-delivers;
 *   · a TERMINAL failure, or one that has used its attempts, becomes `failed` —
 *     requeueing an undeliverable row forever is how a campaign never completes.
 *
 * Channels stay their own adapters (transport, rendering, tables); only this
 * rule and its ceiling are shared, so the two cannot drift apart again.
 */

/** Attempts one delivery row may take before it is written off. */
export const CAMPAIGN_DELIVERY_MAX_ATTEMPTS = 3;

/**
 * Whether an HTTP status from a delivery provider means "come back later".
 *
 * `0` is NO RESPONSE: `executeConnectorAction` reports a fetch failure or its timeout as
 * `{ ok: false, status: 0 }` rather than throwing, and the mailbox service maps a non-provider
 * error to status 0 the same way. A connectivity incident is the textbook transient failure, so
 * it is retryable alongside 429 and 5xx; reading it as terminal wrote off a whole audience.
 * ONE predicate for every transport, so the sites cannot drift apart.
 *
 * It is also what marks a transport failure as `providerUnavailable` (the provider is not serving
 * us, so the batch stops rather than spend an attempt on every remaining row): the set that is
 * worth retrying and the set that says "stop trying the next ones" are the same set.
 */
export function isRetryableProviderStatus(status: number | null | undefined): boolean {
  return status === 0 || status === 429 || (typeof status === 'number' && status >= 500);
}

/**
 * Where a failed delivery goes next.
 *
 * `attemptsMade` INCLUDES the attempt that just failed — callers used to differ
 * on whether to add one, which is exactly the off-by-one this signature removes.
 */
export function failedDeliveryStatus(attemptsMade: number, retryable: boolean): 'queued' | 'failed' {
  const exhausted = attemptsMade >= CAMPAIGN_DELIVERY_MAX_ATTEMPTS;
  return retryable && !exhausted ? 'queued' : 'failed';
}
