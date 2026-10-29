/**
 * ONE reading of "the provider throttled this run", shared by every place that has to tell an
 * AVAILABILITY failure (a model or pool at capacity: demote the model, do not call it bad) from a
 * quality one - the cloud's failure classifier and the ONE agent's outcome row. Two copies drifted
 * once (on-prem read "HTTP 529 over capacity" as a quality failure; the cloud read it as availability).
 *
 * Pure, dependency-free: compiled into the Worker, the browser and Node.
 */

/** The words a provider or gateway uses when it is throttling or out of capacity. */
const AVAILABILITY = /\b429\b|rate.?limit|too many requests|over capacity|capacity limit/i;

/**
 * A tenant's OWN budget being spent - the plan's daily or monthly token cap, a per-host cap, a member's
 * spend cap, the premium or image allowance (the gateway answers these 429 with a `*_limit_exceeded` /
 * `*_cap_exceeded` code, `gatewayGuards.ts`). The customer used their allowance; no model is throttled,
 * so it is NOT an availability signal and must not demote anything.
 */
const TENANT_BUDGET = /_(?:limit|cap)_exceeded\b|token limit reached/i;

/** True when `message` says a model or pool was throttled or at capacity (not that a tenant spent a cap). */
export function isRateLimitFailure(message: string | null | undefined): boolean {
  return !!message && AVAILABILITY.test(message) && !TENANT_BUDGET.test(message);
}
