/**
 * A client-supplied intent key (PRD 42 Part D — dashboard intent).
 *
 * The device already picked the metric/topic key for a question the keyword rules did not
 * recognise. It is accepted ONLY when it is one of the closed `allowedKeys` list the
 * refiner is handed (the tenant's whitelisted keys) — otherwise it is ignored and the
 * server refiner (the gateway) runs exactly as it would have. So the worst a bad client
 * result can do is cost the caller the free path; it can never name a key outside the
 * whitelist (`refineIntent` validates the answer again regardless).
 */
import type { ClientSupplied } from '../llm/clientResult';
import type { IntentRefiner } from './nlQuery';

/** `clientResult.json` for an intent: the key itself, or `{ key }`. */
export type ClientIntentKey = string | { key: string };

export const CLIENT_INTENT_KEY_MAX = 200;

export const CLIENT_INTENT_SPEC = {
  kind: 'json',
  validate: (v: unknown): v is ClientIntentKey =>
    (typeof v === 'string' && v.length > 0 && v.length <= CLIENT_INTENT_KEY_MAX)
    || (typeof v === 'object' && v !== null && typeof (v as { key?: unknown }).key === 'string'
      && (v as { key: string }).key.length > 0 && (v as { key: string }).key.length <= CLIENT_INTENT_KEY_MAX),
} as const;

/**
 * Wrap the server refiner (if any) so an allowed client key wins without a model call.
 * `onAccepted` fires once, only when the client's key was actually used.
 */
export function clientIntentRefiner(
  client: ClientSupplied<ClientIntentKey>,
  fallback: IntentRefiner | undefined,
  onAccepted?: () => Promise<void> | void,
): IntentRefiner {
  const key = (typeof client.value === 'string' ? client.value : client.value.key).trim();
  return async (question, allowedKeys) => {
    if (allowedKeys.includes(key)) {
      await onAccepted?.();
      return key;
    }
    return fallback ? fallback(question, allowedKeys) : null;
  };
}
