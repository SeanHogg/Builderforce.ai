/**
 * Provider MODEL SELECTION — the ordered models a tenant told a connected provider
 * account to route to (`tenant_llm_provider_models`, 1165).
 *
 * Storage only. WHAT can be selected comes from `providerModelCatalog`; HOW a selection
 * routes (seed order, picker rows, pinnable refs) is `byoModelRouting`. A provider with
 * no selection keeps its default flagship, so an empty result changes nothing.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { tenantLlmProviderModels } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { isSupportedProvider, type LlmProvider } from './llmProviderCatalog';
import { providerModelSelectionCacheKey } from './providerModelCacheKeys';

/** Same ceiling as an OpenRouter connection's model set — a failover list, not a catalog. */
export const MAX_SELECTED_PROVIDER_MODELS = 25;

/** A provider model id: letters, digits and the separators real ids use
 *  (`qwen3.8-max-0902`, `ZHIPU/GLM-5.3`, `model:tag`). Bounded so a row is never a blob. */
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;

/** provider → its selected bare model ids, in routing order. */
export type ProviderModelSelections = Partial<Record<LlmProvider, string[]>>;

export type ModelSelectionError = 'invalid_models' | 'too_many_models';

/**
 * Validate + de-duplicate a submitted selection, keeping first-seen order. Pure.
 * Rejects rather than silently dropping a bad id: a selection is an ORDER, and quietly
 * removing one entry would promote the next into a position the tenant never chose.
 */
export function normalizeModelSelection(
  raw: unknown,
): { ok: true; models: string[] } | { ok: false; error: ModelSelectionError } {
  if (!Array.isArray(raw)) return { ok: false, error: 'invalid_models' };
  const models: string[] = [];
  for (const entry of raw) {
    const id = typeof entry === 'string' ? entry.trim() : '';
    if (!MODEL_ID_PATTERN.test(id)) return { ok: false, error: 'invalid_models' };
    if (!models.includes(id)) models.push(id);
  }
  if (models.length > MAX_SELECTED_PROVIDER_MODELS) return { ok: false, error: 'too_many_models' };
  return { ok: true, models };
}

/** Every provider's selection for a tenant. Read-through cached: it is read on every
 *  credential resolve (each completion), and changes only on the writes below. */
export async function listProviderModelSelections(env: Env, tenantId: number): Promise<ProviderModelSelections> {
  return getOrSetCached(env, providerModelSelectionCacheKey(tenantId), async () => {
    const rows = await buildDatabase(env)
      .select({ provider: tenantLlmProviderModels.provider, modelId: tenantLlmProviderModels.modelId })
      .from(tenantLlmProviderModels)
      .where(eq(tenantLlmProviderModels.tenantId, tenantId))
      .orderBy(asc(tenantLlmProviderModels.provider), asc(tenantLlmProviderModels.position));
    const selections: ProviderModelSelections = {};
    for (const row of rows) {
      if (!isSupportedProvider(row.provider)) continue;
      (selections[row.provider] ??= []).push(row.modelId);
    }
    return selections;
  }, { kvTtlSeconds: 3600 });
}

/**
 * Replace one provider's selection with `models` (already normalized), in ONE statement:
 * neon-http has no interactive transaction, so a delete-then-insert pair that failed in
 * between would leave the account with no selection at all. The upsert rewrites every
 * kept model's position and the delete removes the rest; the two touch disjoint rows.
 * The caller has checked the provider is connected — the foreign key is the backstop.
 */
export async function replaceProviderModelSelection(
  env: Env,
  tenantId: number,
  provider: LlmProvider,
  models: readonly string[],
): Promise<void> {
  const db = buildDatabase(env);
  if (models.length === 0) {
    await db.delete(tenantLlmProviderModels).where(and(
      eq(tenantLlmProviderModels.tenantId, tenantId),
      eq(tenantLlmProviderModels.provider, provider),
    ));
  } else {
    // The list travels as ONE jsonb parameter: an array interpolated into `sql` expands
    // into a parameter list, which is not a value `jsonb_array_elements_text` can take.
    const chosen = JSON.stringify(models);
    await db.execute(sql`
      WITH chosen AS (
        SELECT value AS model_id, (ordinality - 1)::int AS position
        FROM jsonb_array_elements_text(${chosen}::jsonb) WITH ORDINALITY
      ), upserted AS (
        INSERT INTO tenant_llm_provider_models (tenant_id, provider, model_id, position)
        SELECT ${tenantId}::int, ${provider}::text, model_id, position FROM chosen
        ON CONFLICT (tenant_id, provider, model_id) DO UPDATE SET position = EXCLUDED.position
        RETURNING model_id
      )
      DELETE FROM tenant_llm_provider_models
      WHERE tenant_id = ${tenantId}::int
        AND provider = ${provider}::text
        AND model_id NOT IN (SELECT model_id FROM chosen)
    `);
  }
  await invalidateCached(env, providerModelSelectionCacheKey(tenantId));
}
