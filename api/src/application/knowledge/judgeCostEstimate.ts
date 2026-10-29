/**
 * The composition of the review's cost estimate (PRD 38 §4.8 `GET …/knowledge/judge/estimate`):
 * binds {@link estimateJudgeCost}'s ports to the gateway — the route is the one the real
 * judge call takes (`tenantProxyForPlan(...).proxy.previewRoute`), the price is the live
 * provider catalog's, and locality is the vendor registry's own declaration.
 *
 * Cached through `getOrSetCached` on tenant + project + the routing inputs' version token
 * (`routingInputsVersion`: provider rows + plan). A connected provider's model selection has
 * no stamp, so the entry also expires after {@link JUDGE_COST_TTL_SECONDS}.
 */
import { listPriceOf } from '@builderforce/model-catalog';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { loadPriceBook } from '../llm/catalogView';
import { routingInputsVersion } from '../llm/routingInputsVersion';
import { tenantProxyForPlan } from '../llm/tenantProxy';
import { vendorForModel, vendorRequiresLocalEgress } from '../llm/vendors';
import { estimateJudgeCost, type JudgeCostEstimate, type JudgeCostPorts } from './estimateJudgeCost';

export const JUDGE_COST_TTL_SECONDS = 300;

export const judgeCostCacheKey = (tenantId: number, projectId: number, routingVersion: string): string =>
  `kjc:v1:${tenantId}:${projectId}:${routingVersion}`;

export async function judgeCostPortsFor(env: Env, tenantId: number): Promise<JudgeCostPorts> {
  const [{ proxy }, book] = await Promise.all([tenantProxyForPlan(env, tenantId), loadPriceBook(env)]);
  return {
    route: (body) => proxy.previewRoute(body),
    price: (model) => listPriceOf(book, model),
    isLocal: (model) => vendorRequiresLocalEgress(vendorForModel(model)),
  };
}

export async function judgeCostFor(env: Env, tenantId: number, projectId: number): Promise<JudgeCostEstimate> {
  const key = judgeCostCacheKey(tenantId, projectId, await routingInputsVersion(env, tenantId));
  return getOrSetCached(env, key, async () => estimateJudgeCost(await judgeCostPortsFor(env, tenantId)), {
    kvTtlSeconds: JUDGE_COST_TTL_SECONDS,
  });
}
