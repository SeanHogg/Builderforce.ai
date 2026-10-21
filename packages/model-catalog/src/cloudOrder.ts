/**
 * The account preference for which cloud funds an unpinned turn — the gateway resolves
 * it (`api/src/application/llm/fundingOrder.ts`) and the web settings card writes it, so
 * both read the words from here.
 *
 *   - `inferred`   — decide from whether a BYO provider is connected (connected ⇒ connected
 *                    accounts first, nothing connected ⇒ free tier first).
 *   - `free_first` — the operator's free tier leads; connected accounts follow it.
 *   - `byo_first`  — connected accounts lead; the plan pool follows them.
 */

export const CLOUD_ORDERS = ['inferred', 'free_first', 'byo_first'] as const;
export type CloudOrder = (typeof CLOUD_ORDERS)[number];

export function isCloudOrder(value: unknown): value is CloudOrder {
  return typeof value === 'string' && (CLOUD_ORDERS as readonly string[]).includes(value);
}
