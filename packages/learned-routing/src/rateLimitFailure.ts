/**
 * ONE reading of "the provider throttled this run", shared by every place that has to tell an
 * AVAILABILITY failure (a model or pool at capacity: demote the model, do not call it bad) from a
 * quality one - the cloud's failure classifier and the ONE agent's outcome row. Two copies drifted
 * once (on-prem read "HTTP 529 over capacity" as a quality failure; the cloud read it as availability).
 *
 * Lives here because this package owns the run-outcome contract and the availability signal it feeds
 * (`rateLimited`), and is dependency-free and I/O-free: compiled into the Worker, the browser and Node.
 */

/** The words a provider or gateway uses when it is throttling or out of capacity. */
const AVAILABILITY = /\b429\b|rate.?limit|too many requests|over capacity|capacity limit/i;

/**
 * The codes OUR gateway answers 429 with when a TENANT spends its own allowance (`gatewayGuards.ts`,
 * `videoRoutes.ts`; the SDK's `TOKEN_CAP_CODES` is the same list). The customer used what they were
 * given: no model is throttled, so none of these is an availability signal and none may demote anything.
 * An EXPLICIT list, not a `*_limit_exceeded` pattern: OpenAI's own `rate_limit_exceeded` is a genuine
 * provider throttle and must keep reading as one.
 */
export const TENANT_BUDGET_CODES: readonly string[] = [
  'agent_host_token_limit_exceeded',
  'plan_token_limit_exceeded',
  'plan_monthly_token_limit_exceeded',
  'member_spend_cap_exceeded',
  'premium_daily_cap_exceeded',
  'image_credit_limit_exceeded',
  'video_credit_limit_exceeded',
  'claw_token_limit_exceeded',
];

const BUDGET_CODE = new RegExp(`\\b(?:${TENANT_BUDGET_CODES.join('|')})\\b`);

/**
 * The gateway's human wording for the same thing, for a message that arrives without its code. TENANT
 * phrasing only: "Plan daily token limit reached (50,000 tokens)", "...allowance reached", "Daily image
 * generation limit reached", "Monthly AI spend cap reached", "Daily premium-model budget exhausted". NOT a run
 * stopping at its OWN per-run cap ("token limit reached (12/200000 tokens)" - no plan or window word), and NOT
 * a bare "budget exhausted" ("401 Unauthorized ... retry budget exhausted").
 */
const BUDGET_WORDING = new RegExp(
  [
    /(?:plan|daily|monthly|agenthost)\b[^.]{0,30}\btoken limit reached/,
    /generation limit reached/,
    /allowance reached/,
    /spend cap reached/,
    /(?:premium|token|spend|credit|plan)\b[^.]{0,40}budget exhausted/,
  ]
    .map((re) => re.source)
    .join('|'),
  'i',
);

/** True when `message` says a TENANT spent its own cap or allowance (not that any model was throttled). */
export function isTenantBudgetFailure(message: string | null | undefined): boolean {
  return !!message && (BUDGET_CODE.test(message) || BUDGET_WORDING.test(message));
}

/** True when `message` says a model or pool was throttled or at capacity (not that a tenant spent a cap). */
export function isRateLimitFailure(message: string | null | undefined): boolean {
  return !!message && AVAILABILITY.test(message) && !isTenantBudgetFailure(message);
}
