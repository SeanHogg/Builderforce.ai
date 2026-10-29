/**
 * The composition of the review's cost estimate (PRD 38 §4.8 `GET …/knowledge/judge/estimate`):
 * binds {@link estimateJudgeCost}'s ports to the gateway — the route is the one the real
 * judge call takes (`tenantProxyForPlan(...).proxy.previewRoute`), the price is the live
 * provider catalog's, and locality is the vendor registry's own declaration.
 *
 * Cached through `getOrSetCached` on tenant + the routing inputs' version token
 * (`routingInputsVersion`: provider rows + plan + premium override + each provider's selected
 * models). Routing is per TENANT, and the estimate never reads the project (the route has
 * already checked it is the tenant's), so the project is not in the key. Key health,
 * cooldowns and the price book move without any of those, so the entry also expires after
 * {@link JUDGE_COST_TTL_SECONDS}.
 */
import { listPriceOf } from '@builderforce/model-catalog';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { loadPriceBook } from '../llm/catalogView';
import { routingInputsVersion } from '../llm/routingInputsVersion';
import { tenantProxyForPlan } from '../llm/tenantProxy';
import { vendorForModel, vendorRunsOnDevice } from '../llm/vendors';
import { estimateJudgeCost, type JudgeCostEstimate, type JudgeCostPorts } from './estimateJudgeCost';

export const JUDGE_COST_TTL_SECONDS = 300;

export const judgeCostCacheKey = (tenantId: number, routingVersion: string): string =>
  `kjc:v2:${tenantId}:${routingVersion}`;

export async function judgeCostPortsFor(env: Env, tenantId: number): Promise<JudgeCostPorts> {
  const [{ proxy }, book] = await Promise.all([tenantProxyForPlan(env, tenantId), loadPriceBook(env)]);
  return {
    route: (body) => proxy.previewRoute(body),
    price: (model) => listPriceOf(book, model),
    // On the tenant's own hardware (`runsOnDevice`), NOT merely local-egress: Kimi is cloud and priced.
    isLocal: (model) => vendorRunsOnDevice(vendorForModel(model)),
  };
}

export async function judgeCostFor(env: Env, tenantId: number): Promise<JudgeCostEstimate> {
  const key = judgeCostCacheKey(tenantId, await routingInputsVersion(env, tenantId));
  return getOrSetCached(env, key, async () => estimateJudgeCost(await judgeCostPortsFor(env, tenantId)), {
    kvTtlSeconds: JUDGE_COST_TTL_SECONDS,
  });
}
