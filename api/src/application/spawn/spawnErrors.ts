/**
 * Spawn's refusal vocabulary. Each refusal carries its HTTP `status` (the rule the
 * global error handler applies) and a stable `code` the website and the desktop app
 * translate — the English message is a fallback, never the text a player reads.
 */
export type SpawnErrorCode =
  | 'age_required'
  | 'too_young'
  | 'membership_required'
  | 'insufficient_tokens'
  | 'pack_not_found'
  | 'payments_unavailable'
  | 'payment_not_found'
  | 'payment_not_paid'
  | 'payment_wrong_kind'
  | 'payment_not_yours'
  | 'payment_short'
  | 'prompt_empty'
  | 'generator_unavailable'
  | 'generator_unreadable';

export class SpawnError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 402 | 403 | 404 | 502,
    readonly code: SpawnErrorCode,
  ) {
    super(message);
    this.name = 'SpawnError';
  }
}
