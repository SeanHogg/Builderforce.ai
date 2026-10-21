import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { settings } from '../../infrastructure/database/schema';
import type { UserId } from '../../domain/shared/types';
import { getOrSetCached, invalidateCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';
import { isCloudOrder, type CloudOrder } from '@builderforce/model-catalog';

export const BRAIN_EFFORTS = ['quick', 'balanced', 'thorough'] as const;
export const BRAIN_MODEL_MODES = ['auto', 'byo_pool', 'model'] as const;
export type AccountBrainEffort = (typeof BRAIN_EFFORTS)[number];
export type AccountBrainModelMode = (typeof BRAIN_MODEL_MODES)[number];

export interface AccountBrainPreferences {
  effort: AccountBrainEffort;
  thinking: boolean;
  webBrowsing: boolean;
  modelSelection: { mode: 'auto' | 'byo_pool' } | { mode: 'model'; model: string };
  responseInstructions: string;
  /** Which cloud funds an unpinned turn — see `fundingOrder.ts`. `inferred` = from
   *  whether a BYO provider is connected. */
  cloudOrder: CloudOrder;
}

export const DEFAULT_ACCOUNT_BRAIN_PREFERENCES: AccountBrainPreferences = {
  effort: 'balanced',
  thinking: false,
  webBrowsing: false,
  modelSelection: { mode: 'auto' },
  responseInstructions: '',
  cloudOrder: 'inferred',
};

const BRAIN_SETTINGS_FEATURE = 'brain';

const cacheKey = (tenantId: number, userId: UserId) => `brain-prefs:tenant:${tenantId}:user:${userId}`;

async function loadStoredPreferences(db: Db, tenantId: number, userId: UserId): Promise<unknown> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(and(
    eq(settings.tenantId, tenantId),
    eq(settings.scope, 'user'),
    eq(settings.scopeRef, userId),
    eq(settings.feature, BRAIN_SETTINGS_FEATURE),
  )).limit(1);
  return row?.value ?? null;
}

/** The person's preferences — read through the shared cache (the gateway reads
 *  `cloudOrder` on every completion), invalidated by {@link setAccountBrainPreferences}.
 *  Staleness: a write deletes the KV copy and THIS isolate's L1, but L1 is per-isolate with
 *  the default TTL (`L1_TTL_MS`, 30 s), so another isolate can serve the old `cloudOrder`
 *  for up to that long. The save's read-modify-write is unguarded (no row lock pattern in
 *  this module): two concurrent partial saves can drop one field — acceptable for a
 *  one-person settings card. */
export async function getAccountBrainPreferences(env: CacheEnv, db: Db, tenantId: number, userId: UserId): Promise<AccountBrainPreferences> {
  return getOrSetCached(env, cacheKey(tenantId, userId), async () => {
    const stored = await loadStoredPreferences(db, tenantId, userId);
    return stored ? parseAccountBrainPreferences(stored) : DEFAULT_ACCOUNT_BRAIN_PREFERENCES;
  }, { kvTtlSeconds: 3600 });
}

export function parseAccountBrainPreferences(input: unknown): AccountBrainPreferences {
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const effort = BRAIN_EFFORTS.includes(body.effort as AccountBrainEffort)
    ? body.effort as AccountBrainEffort
    : DEFAULT_ACCOUNT_BRAIN_PREFERENCES.effort;
  const selection = body.modelSelection && typeof body.modelSelection === 'object'
    ? body.modelSelection as Record<string, unknown>
    : {};
  const mode = BRAIN_MODEL_MODES.includes(selection.mode as AccountBrainModelMode)
    ? selection.mode as AccountBrainModelMode
    : 'auto';
  const model = typeof selection.model === 'string' ? selection.model.trim().slice(0, 500) : '';
  return {
    effort,
    thinking: body.thinking === true,
    webBrowsing: body.webBrowsing === true,
    modelSelection: mode === 'model' && model ? { mode: 'model', model } : mode === 'byo_pool' ? { mode: 'byo_pool' } : { mode: 'auto' },
    responseInstructions: typeof body.responseInstructions === 'string' ? body.responseInstructions.trim().slice(0, 2_000) : '',
    cloudOrder: isCloudOrder(body.cloudOrder) ? body.cloudOrder : DEFAULT_ACCOUNT_BRAIN_PREFERENCES.cloudOrder,
  };
}

/**
 * Save a PARTIAL update: fields the caller omits keep their stored value, so a client
 * that does not know a newer field (e.g. `cloudOrder`) cannot reset it by saving the rest.
 */
export async function setAccountBrainPreferences(env: CacheEnv, db: Db, tenantId: number, userId: UserId, input: unknown): Promise<AccountBrainPreferences> {
  const stored = await loadStoredPreferences(db, tenantId, userId);
  const patch = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const preferences = parseAccountBrainPreferences({
    ...(stored && typeof stored === 'object' ? stored as Record<string, unknown> : {}),
    ...patch,
  });
  await db.insert(settings).values({
    tenantId,
    scope: 'user',
    scopeRef: userId,
    feature: BRAIN_SETTINGS_FEATURE,
    value: preferences,
    updatedBy: userId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [settings.tenantId, settings.scope, settings.scopeRef, settings.feature],
    set: {
      value: preferences,
      updatedBy: userId,
      updatedAt: new Date(),
    },
  });
  await invalidateCached(env, cacheKey(tenantId, userId));
  return preferences;
}
