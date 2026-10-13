/**
 * The operator's per-workspace Insights switches (PRD 33 D8, D9, D17):
 *
 *   - `tenants.settings.replayExcluded` (D9) — never record this workspace's members
 *     on builderforce.ai, read by the consumption snapshot (`consumption/meters.ts`)
 *     that the frontend loader gate consumes;
 *   - `tenants.settings.replayFreeAllowanceOverride` (D8) — this workspace's free
 *     recordings per month (0 = the real-payment validation workspace), read by
 *     `replayUsage.ts`.
 *
 * `tenants.settings` is a JSON-as-text blob shared by many features (embed,
 * navigation, …), so a write merges only these two keys and preserves every other
 * one. Every change is an `admin_audit_log` row (`REPLAY_TENANT_SETTINGS_CHANGED`,
 * before/after) written on the same path, and the cached reads that depend on the
 * two keys are dropped so the change is enforced at once rather than on a TTL.
 */
import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { tenants } from '../../infrastructure/database/schema';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { writeAdminAudit } from '../../infrastructure/audit/adminAudit';
import { parseJsonObject } from '../../domain/shared/json';
import { NotFoundError, ValidationError } from '../../domain/shared/errors';
import { invalidateConsumptionSnapshot } from '../consumption/meters';
import { allowanceOverrideKey } from './replayCacheKeys';

export const REPLAY_TENANT_SETTINGS_CHANGED_EVENT = 'REPLAY_TENANT_SETTINGS_CHANGED';

/** Anything above this is a typo, not a decision (matches the largest grant). */
export const REPLAY_ALLOWANCE_OVERRIDE_MAX = 1_000_000;

export interface ReplayTenantSettings {
  replayExcluded: boolean;
  /** Null = the catalog's free allowance applies. */
  replayFreeAllowanceOverride: number | null;
}

export type ReplayTenantSettingsPatch = Partial<ReplayTenantSettings>;

/** The two switches as the readers interpret them (same rules as `meters.ts` / `replayUsage.ts`). */
export function readReplayTenantSettings(raw: unknown): ReplayTenantSettings {
  const settings = parseJsonObject<{ replayExcluded?: unknown; replayFreeAllowanceOverride?: unknown }>(raw);
  const override = settings.replayFreeAllowanceOverride;
  return {
    replayExcluded: settings.replayExcluded === true,
    replayFreeAllowanceOverride:
      typeof override === 'number' && Number.isFinite(override) && override >= 0 ? Math.floor(override) : null,
  };
}

/**
 * Merge the two switches into the stored blob, preserving every other key. A null
 * override removes the key (the readers treat absent and null alike).
 */
export function mergeReplayTenantSettings(raw: unknown, next: ReplayTenantSettings): string {
  const settings: Record<string, unknown> = { ...parseJsonObject<Record<string, unknown>>(raw) };
  settings.replayExcluded = next.replayExcluded;
  if (next.replayFreeAllowanceOverride === null) delete settings.replayFreeAllowanceOverride;
  else settings.replayFreeAllowanceOverride = next.replayFreeAllowanceOverride;
  return JSON.stringify(settings);
}

function validatePatch(patch: ReplayTenantSettingsPatch): void {
  if (patch.replayExcluded === undefined && patch.replayFreeAllowanceOverride === undefined) {
    throw new ValidationError('Nothing to change');
  }
  const override = patch.replayFreeAllowanceOverride;
  if (override !== undefined && override !== null
    && (!Number.isInteger(override) || override < 0 || override > REPLAY_ALLOWANCE_OVERRIDE_MAX)) {
    throw new ValidationError(`replayFreeAllowanceOverride must be null or a whole number from 0 to ${REPLAY_ALLOWANCE_OVERRIDE_MAX}`);
  }
}

async function loadSettingsBlob(db: Db, tenantId: number): Promise<string | null> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new ValidationError('tenantId must be a workspace id');
  const [row] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!row) throw new NotFoundError('Workspace', tenantId);
  return row.settings ?? null;
}

/**
 * The operator's read. Deliberately uncached: it is a one-row primary-key read on an
 * admin screen that must show the value just written, and every enforcing reader
 * keeps its own cache.
 */
export async function getReplayTenantSettings(db: Db, tenantId: number): Promise<ReplayTenantSettings> {
  return readReplayTenantSettings(await loadSettingsBlob(db, tenantId));
}

export async function updateReplayTenantSettings(
  db: Db,
  env: Env | undefined,
  input: { actorId: string; tenantId: number; patch: ReplayTenantSettingsPatch; ipAddress?: string | null },
): Promise<ReplayTenantSettings> {
  validatePatch(input.patch);
  const raw = await loadSettingsBlob(db, input.tenantId);
  const before = readReplayTenantSettings(raw);
  const after: ReplayTenantSettings = {
    replayExcluded: input.patch.replayExcluded ?? before.replayExcluded,
    replayFreeAllowanceOverride: input.patch.replayFreeAllowanceOverride !== undefined
      ? input.patch.replayFreeAllowanceOverride
      : before.replayFreeAllowanceOverride,
  };

  // Audit on the same path, first: a failed audit write fails the change.
  await writeAdminAudit(db, REPLAY_TENANT_SETTINGS_CHANGED_EVENT, input.actorId, {
    tenantId: input.tenantId,
    metadata: { before, after },
    ipAddress: input.ipAddress ?? null,
  });

  await db
    .update(tenants)
    .set({ settings: mergeReplayTenantSettings(raw, after), updatedAt: new Date() })
    .where(eq(tenants.id, input.tenantId));

  await Promise.all([
    invalidateCached(env, allowanceOverrideKey(input.tenantId)),
    invalidateConsumptionSnapshot(env, input.tenantId),
  ]);
  return after;
}
