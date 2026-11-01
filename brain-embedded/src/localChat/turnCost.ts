/**
 * What ONE completed turn is worth on the device, in millicents - THE rule both engines' USD caps read: the Brain's loop
 * (`runStore/runSpendBudget.ts`) accrues it after each turn, and the agent's budget reads it as `ModelUsage.pricedMc`
 * (`run/modelTransport.ts`). Undefined means the turn has no known price - it is counted as UNPRICED, never as free.
 *
 *   - a turn that reported no usage cannot be priced: off the device it is unpriced; on it, it costs nothing;
 *   - otherwise the device's one call-cost rule (`callCost.ts`), by where the call ran and the model that served it.
 */

import type { PriceBook } from '@builderforce/model-catalog';
import type { StreamChatResult } from '../streamChatCompletion';
import { callCostOrUnknown } from './callCost';
import { servedModel, usageRouteOf } from './usageLedger';

export function turnPriceMc(result: StreamChatResult, requested: string | undefined, book?: PriceBook): number | undefined {
  const route = usageRouteOf(result, requested);
  const usage = result.usage;
  if (!usage) return route === 'local' ? 0 : undefined;
  return callCostOrUnknown(servedModel(result, requested), {
    prompt: usage.prompt ?? 0,
    completion: usage.completion ?? 0,
    cacheRead: usage.cacheRead ?? 0,
    cacheCreation: usage.cacheCreation ?? 0,
  }, book, route);
}
