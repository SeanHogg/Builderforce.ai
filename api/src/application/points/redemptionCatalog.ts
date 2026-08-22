/**
 * WHAT POINTS BUY — the SKUs, and the one place that knows whether each is real.
 *
 * ── THE FAILURE THIS FILE IS SHAPED TO PREVENT ───────────────────────────────
 * The source product's catalog endpoint and its redeem guard were two lists. The
 * catalog advertised gift cards; the guard rejected them, because the gift-card
 * rail had refused the account months earlier. Users saw a reward, spent the
 * points getting to it, and were refused at the last step.
 *
 * So availability is not a field somebody remembers to set — it is DERIVED from
 * whether a fulfilment adapter is registered for the SKU's kind. A reward with no
 * way to deliver it cannot be advertised as available, because the same function
 * answers both questions.
 *
 * ── PRICING ──────────────────────────────────────────────────────────────────
 * One rate, stated once: 1,000 points ≈ $1 of retail value, and AI tokens are
 * priced from the platform's own cost basis. Anything cheaper turns the daily
 * caps in `pointsCatalog` into a farming target with a real payout attached.
 */

/** The kinds a SKU can be. A kind is fulfillable exactly when
 *  {@link fulfilmentKinds} contains it. */
export type RedemptionKind = 'ai_tokens';

export interface RedemptionSku {
  id: string;
  kind: RedemptionKind;
  label: string;
  /** Points required. */
  pointsCost: number;
  /** The kind-specific grant. For `ai_tokens`, `{ tokens }`. */
  grant: Record<string, number>;
}

export const REDEMPTION_CATALOG: readonly RedemptionSku[] = [
  { id: 'ai_tokens_100k', kind: 'ai_tokens', label: '100K AI tokens', pointsCost: 500, grant: { tokens: 100_000 } },
  { id: 'ai_tokens_500k', kind: 'ai_tokens', label: '500K AI tokens', pointsCost: 2_000, grant: { tokens: 500_000 } },
  { id: 'ai_tokens_2m', kind: 'ai_tokens', label: '2M AI tokens', pointsCost: 7_500, grant: { tokens: 2_000_000 } },
];

/**
 * The kinds this build can actually deliver.
 *
 * Registered by `redeemPoints.ts`, which owns the adapters — so adding a reward
 * means writing its fulfilment, and a SKU whose fulfilment does not exist shows
 * as unavailable rather than as a promise. Both the catalog read and the redeem
 * guard call {@link isRedemptionAvailable}, so they cannot drift.
 */
const fulfilmentKinds = new Set<RedemptionKind>();

export function registerFulfilmentKind(kind: RedemptionKind): void {
  fulfilmentKinds.add(kind);
}

export function isRedemptionAvailable(kind: RedemptionKind): boolean {
  return fulfilmentKinds.has(kind);
}

export function getRedemptionSku(id: string): RedemptionSku | null {
  return REDEMPTION_CATALOG.find((sku) => sku.id === id) ?? null;
}

/** The catalog as a client sees it: every SKU, each honestly labelled with
 *  whether it can be delivered right now. */
export function catalogWithAvailability(): Array<RedemptionSku & { available: boolean }> {
  return REDEMPTION_CATALOG.map((sku) => ({ ...sku, available: isRedemptionAvailable(sku.kind) }));
}
