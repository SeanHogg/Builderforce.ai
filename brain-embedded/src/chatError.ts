/**
 * Chat request errors, and the ONE classifier that decides what a user can DO
 * about one.
 *
 * The gateway already answers a blocked request with a fully structured body —
 * `{ error, code, reason, unlock, requiredPlan, feature }` (see the API's
 * `premiumModelGateBody`). That structure used to be thrown away at the fetch
 * boundary, leaving the UI with a bare sentence like "…require a validated card
 * on file. Add and validate a card in Settings ▸ Billing to unlock." — prose
 * telling the user to go somewhere the surface never offered to take them.
 *
 * {@link BrainRequestError} preserves the fields, and {@link chatErrorAction} is
 * the single place that turns any thrown error into an actionable verdict. Both
 * the run store (which records the verdict on the run cell) and the banner UI
 * (which renders the button) read it, so the message and its call-to-action can
 * never disagree — and no consumer re-implements a regex over error prose.
 */

/** What the user can do about a failed turn. `null` ⇒ nothing but dismiss. */
export type ChatErrorActionKind =
  /** Session expired/invalid — re-exchange the token in place. */
  | 'auth'
  /** Plan doesn't include the capability — send them to pricing. */
  | 'upgrade'
  /** Plan is fine, but billing needs a validated card — send them to billing. */
  | 'validate_card';

export interface ChatErrorAction {
  kind: ChatErrorActionKind;
  /** Plan that WOULD satisfy the request ('pro'), when the server named one. */
  requiredPlan?: string;
  /** Entitlement key that was refused ('premiumModels'), when the server named one. */
  feature?: string;
}

/**
 * An HTTP failure from the gateway, carrying whatever structured entitlement
 * fields the body supplied. `message` stays the human sentence, so anything that
 * only renders text is unaffected.
 */
export class BrainRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly reason?: string;
  readonly unlock?: string;
  readonly requiredPlan?: string;
  readonly feature?: string;

  constructor(
    message: string,
    init: {
      status: number;
      code?: string;
      reason?: string;
      unlock?: string;
      requiredPlan?: string;
      feature?: string;
    },
  ) {
    super(message);
    this.name = 'BrainRequestError';
    this.status = init.status;
    this.code = init.code;
    this.reason = init.reason;
    this.unlock = init.unlock;
    this.requiredPlan = init.requiredPlan;
    this.feature = init.feature;
  }
}

/** Read a field only when the body actually carried it as a string. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Build a {@link BrainRequestError} from a gateway error body, keeping every
 * entitlement field the server sent.
 */
export function brainRequestError(status: number, body: unknown, statusText?: string): BrainRequestError {
  const b = (body ?? {}) as Record<string, unknown>;
  const message =
    str(b.error) || str(b.message) || statusText || `Request failed (${status})`;
  return new BrainRequestError(message, {
    status,
    code: str(b.code),
    reason: str(b.reason),
    unlock: str(b.unlock),
    requiredPlan: str(b.requiredPlan),
    feature: str(b.feature),
  });
}

/**
 * Prose fallbacks, for an older gateway (or a non-JSON edge/proxy error) that
 * carries no structured fields. Deliberately narrow: a wrong guess here would
 * offer an upgrade button for an unrelated failure.
 */
const AUTH_PROSE = /invalid or expired token|unauthor/i;
const CARD_PROSE = /validated card|add a card|card on file/i;
const UPGRADE_PROSE = /requires? a paid plan|upgrade to (pro|teams)|plan (token )?limit|not included in your plan/i;

/**
 * Classify any thrown value into the action the user can take. Structured fields
 * win; prose is only consulted when the server gave us nothing to go on.
 */
export function chatErrorAction(err: unknown): ChatErrorAction | null {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';

  if (err instanceof BrainRequestError) {
    const base = { requiredPlan: err.requiredPlan, feature: err.feature };
    if (err.status === 401) return { kind: 'auth', ...base };
    if (err.unlock === 'validate_card' || err.reason === 'card_required') {
      return { kind: 'validate_card', ...base };
    }
    if (err.unlock === 'upgrade' || err.reason === 'plan_required' || err.status === 402) {
      return { kind: 'upgrade', ...base };
    }
    // 429s the gateway raises for a plan allowance (not provider rate limits).
    if (err.status === 429 && /plan_.*limit/.test(err.code ?? '')) {
      return { kind: 'upgrade', ...base };
    }
  }

  if (!message) return null;
  if (AUTH_PROSE.test(message)) return { kind: 'auth' };
  if (CARD_PROSE.test(message)) return { kind: 'validate_card' };
  if (UPGRADE_PROSE.test(message)) return { kind: 'upgrade' };
  return null;
}
