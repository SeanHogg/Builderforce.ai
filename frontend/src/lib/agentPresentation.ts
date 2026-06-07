import type { PublishedAgent } from '@/lib/types';

/**
 * Canonical price label for a published/cloud agent. Single source of truth for
 * the "Free" / "$x" / "$x / unit" rule — previously re-implemented inline in
 * WorkforceAgents and the marketplace. Reads the snake_case row fields.
 */
export function formatAgentPrice(
  a: Pick<PublishedAgent, 'price_cents' | 'pricing_model' | 'price_unit'>
): string {
  if (!a.price_cents) return 'Free';
  const dollars = (a.price_cents / 100).toFixed(2);
  return a.pricing_model === 'consumption'
    ? `$${dollars}${a.price_unit ? ` / ${a.price_unit}` : ' / unit'}`
    : `$${dollars}`;
}
