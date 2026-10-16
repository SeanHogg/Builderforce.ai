/**
 * Expected cost of serving a workload on a model — the number a cost-first call is
 * ordered by.
 *
 * `local` models cost nothing (the user's own CPU/GPU) and FREE-tier models cost the
 * tenant nothing; a priced model costs `price x estimated tokens`. A model with no
 * known price and no free tier has an UNKNOWN cost (`undefined`), which never beats a
 * known one — an absent price is not evidence of cheapness.
 */

import { ZERO_PRICE, estimateCostUsd, residencyOf, type CatalogView } from '@builderforce/model-catalog';
import type { WorkloadProfile } from '@builderforce/workload';

export type CostWorkload = Pick<WorkloadProfile, 'inputTokens' | 'outputTokens'>;

export function expectedCostUsd(model: string, workload: CostWorkload, view: CatalogView): number | undefined {
  if (residencyOf(view, model) === 'local') return 0;
  const price = view.priceOf?.(model) ?? (view.tierOf(model) === 'FREE' ? ZERO_PRICE : undefined);
  return price ? estimateCostUsd(price, workload.inputTokens, workload.outputTokens) : undefined;
}

/**
 * Stable-order models by expected cost, cheapest first; unknown-cost models keep their
 * given order after every known one. Never adds or drops a model. Pure.
 */
export function orderByExpectedCost(models: readonly string[], workload: CostWorkload, view: CatalogView): string[] {
  return models
    .map((m, i) => ({ m, i, cost: expectedCostUsd(m, workload, view) }))
    .sort((a, b) => {
      if (a.cost === undefined || b.cost === undefined) {
        if (a.cost === b.cost) return a.i - b.i;
        return a.cost === undefined ? 1 : -1;
      }
      return a.cost - b.cost || a.i - b.i;
    })
    .map(({ m }) => m);
}
