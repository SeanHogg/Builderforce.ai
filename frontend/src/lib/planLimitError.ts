/**
 * Structured errors thrown on HTTP 402.
 *
 * 402 means "payment required", and the platform now has TWO reasons to say it:
 *
 *   • a PLAN LIMIT — `{ error, upgradeRequired: true, currentPlan }`. The answer
 *     is an upgrade, and the UI shows the upgrade modal.
 *   • a PURCHASE REQUIRED — `{ error, checkoutRequired: true, priceCents }`,
 *     raised by the marketplace-agent hire gate. The answer is a one-off
 *     checkout for THIS item; upgrading the plan would not help and offering it
 *     would be a lie about what the workspace has to do next.
 *
 * They are separate classes rather than one with a flag so `isPlanLimitError`
 * keeps its exact old meaning: every existing caller narrows to the upgrade
 * modal, and none of them starts showing it for a purchase.
 */

export interface PlanLimitPayload {
  error: string;
  upgradeRequired?: boolean;
  currentPlan?: string;
}

export class PlanLimitError extends Error {
  readonly currentPlan: string;
  readonly upgradeRequired: true;

  constructor(payload: PlanLimitPayload) {
    super(payload.error || 'Plan limit reached');
    this.name = 'PlanLimitError';
    this.currentPlan = payload.currentPlan ?? 'free';
    this.upgradeRequired = true;
  }
}

export function isPlanLimitError(e: unknown): e is PlanLimitError {
  return e instanceof PlanLimitError;
}

/**
 * A one-off purchase the caller has not made — the marketplace-agent hire gate.
 *
 * Carries the PRICE, because the only useful next step is "pay this", and a
 * component that had to re-fetch the agent to learn what it costs would show a
 * price that could differ from the one the gate refused against.
 */
export interface PurchaseRequiredPayload {
  error: string;
  checkoutRequired?: boolean;
  priceCents?: number;
}

export class PurchaseRequiredError extends Error {
  readonly priceCents: number;
  readonly checkoutRequired: true;

  constructor(payload: PurchaseRequiredPayload) {
    super(payload.error || 'Purchase required');
    this.name = 'PurchaseRequiredError';
    this.priceCents = payload.priceCents ?? 0;
    this.checkoutRequired = true;
  }
}

export function isPurchaseRequiredError(e: unknown): e is PurchaseRequiredError {
  return e instanceof PurchaseRequiredError;
}

/**
 * Parse a 402 response body into the error that matches WHY it was refused.
 * Safe on non-JSON bodies — an unparseable 402 falls back to the plan-limit
 * reading, which is what every 402 meant before checkout gates existed.
 */
export async function planLimitErrorFromResponse(
  res: Response,
): Promise<PlanLimitError | PurchaseRequiredError> {
  const body = (await res.json().catch(() => ({}))) as PlanLimitPayload & PurchaseRequiredPayload;
  if (body.checkoutRequired) return new PurchaseRequiredError(body);
  return new PlanLimitError(body);
}
