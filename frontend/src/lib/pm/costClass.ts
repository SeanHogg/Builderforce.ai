import type { CostClass } from '@/lib/builderforceApi';

/** CAPEX/OPEX accent tokens — one source of truth for every spine/reconcile surface. */
export const COST_CLASS_COLORS: Record<CostClass, string> = {
  capex: '#3f8fe0', // investment / new value
  opex: '#9a6bd0',  // run / maintain
};

/** Compact USD formatting for cost badges ($0 → $1.2k → $3.40M). */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 100) return `$${n.toFixed(1)}`;
  if (n < 1000) return `$${n.toFixed(0)}`;
  if (n < 1_000_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${(n / 1_000_000).toFixed(2)}M`;
}
