/**
 * Structured error thrown on HTTP 402 responses from plan-limit gates.
 * The API returns { error, upgradeRequired: true, currentPlan } — we
 * preserve that so callers can show an upgrade modal instead of a toast.
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

/** Parse a 402 response body into a PlanLimitError. Safe on non-JSON bodies. */
export async function planLimitErrorFromResponse(res: Response): Promise<PlanLimitError> {
  const body = (await res.json().catch(() => ({}))) as PlanLimitPayload;
  return new PlanLimitError(body);
}
