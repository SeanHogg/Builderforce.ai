/**
 * managerPolicyStore — READING AND WRITING the two rows the manager policy folds from.
 *
 * A leaf between `managerPolicy.ts` (the pure three-tier fold, which knows no database)
 * and everything that needs to ask "what may the manager do on this project?". It exists
 * as its own module for one structural reason: `ManagerService` imports the stall census,
 * and the census must consult the policy (0380 — `requireSignoffToComplete` decides
 * whether an open manifest slot is a stall cause at all). Leaving these readers inside
 * `ManagerService` would make that a static import cycle, and this codebase has already
 * paid for one of those — a cycle through `signoffRequest → participantStates →
 * signoffContract` left a constant uninitialised at module load, caught by tests rather
 * than by `tsc`.
 *
 * So: the store depends only on the schema, the connection and the pure fold. Everything
 * else depends on the store.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projectManagerConfigs, tenantManagerDefaults } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { normalizeManagerType } from './managerTypes';
import {
  resolveTieredManagerPolicy, normalizePrMergePolicy, DEFAULT_MANAGER_POLICY, isProjectManaged,
  type EffectiveManagerPolicy, type ManagerConfigRow, type TenantManagerDefaultsRow,
} from './managerPolicy';


/** A stored config row plus its last-run stamp (the surface shows both). */
export type ManagerConfigRowWithMeta = ManagerConfigRow & { lastRunAt: Date | null };

/** Load a project's manager config row (null when it has none → tenant default). */
export async function getManagerConfigRow(
  db: Db, tenantId: number, projectId: number,
): Promise<ManagerConfigRowWithMeta | null> {
  const [row] = await db
    .select({
      managerRef: projectManagerConfigs.managerRef,
      enabled: projectManagerConfigs.enabled,
      prMergePolicy: projectManagerConfigs.prMergePolicy,
      autoAssign: projectManagerConfigs.autoAssign,
      autoBusinessValue: projectManagerConfigs.autoBusinessValue,
      autoPrioritize: projectManagerConfigs.autoPrioritize,
      autoSchedule: projectManagerConfigs.autoSchedule,
      managerType: projectManagerConfigs.managerType,
      requireSignoffToComplete: projectManagerConfigs.requireSignoffToComplete,
      allowAutoMerge: projectManagerConfigs.allowAutoMerge,
      allowUnattendedCeremonies: projectManagerConfigs.allowUnattendedCeremonies,
      allowAgentReassignment: projectManagerConfigs.allowAgentReassignment,
      agentReassignIdleHours: projectManagerConfigs.agentReassignIdleHours,
      agentReassignMaxPerSession: projectManagerConfigs.agentReassignMaxPerSession,
      allowAutoStaffLanes: projectManagerConfigs.allowAutoStaffLanes,
      lastRunAt: projectManagerConfigs.lastRunAt,
    })
    .from(projectManagerConfigs)
    .where(and(eq(projectManagerConfigs.tenantId, tenantId), eq(projectManagerConfigs.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

// ── workspace (tenant) tier ─────────────────────────────────────────────────

/** KV key for a tenant's workspace manager defaults (invalidated on every write). */
const tenantDefaultsCacheKey = (tenantId: number) => `manager-defaults:tenant:${tenantId}`;

/**
 * Load a tenant's workspace manager defaults (null when the workspace has never stated a
 * posture → the hardcoded defaults apply). Read through the shared cache when an `env` is
 * available: this row is read once per project on EVERY manager sweep tick, so an uncached
 * read multiplies one unchanging row by the project count every five minutes.
 */
export async function getTenantManagerDefaults(
  db: Db, tenantId: number, env?: Env,
): Promise<TenantManagerDefaultsRow | null> {
  const load = async (): Promise<TenantManagerDefaultsRow | null> => {
    const [row] = await db
      .select({
        enabled: tenantManagerDefaults.enabled,
        prMergePolicy: tenantManagerDefaults.prMergePolicy,
        autoAssign: tenantManagerDefaults.autoAssign,
        autoBusinessValue: tenantManagerDefaults.autoBusinessValue,
        autoPrioritize: tenantManagerDefaults.autoPrioritize,
        autoSchedule: tenantManagerDefaults.autoSchedule,
        requireSignoffToComplete: tenantManagerDefaults.requireSignoffToComplete,
        allowAutoMerge: tenantManagerDefaults.allowAutoMerge,
        // Ceremony autonomy (0365) rides the same tier and the same fold.
        allowUnattendedCeremonies: tenantManagerDefaults.allowUnattendedCeremonies,
        allowAgentReassignment: tenantManagerDefaults.allowAgentReassignment,
        agentReassignIdleHours: tenantManagerDefaults.agentReassignIdleHours,
        agentReassignMaxPerSession: tenantManagerDefaults.agentReassignMaxPerSession,
        // Lane auto-staffing (0386) rides the same tier and the same fold.
        allowAutoStaffLanes: tenantManagerDefaults.allowAutoStaffLanes,
      })
      .from(tenantManagerDefaults)
      .where(eq(tenantManagerDefaults.tenantId, tenantId))
      .limit(1);
    return row ?? null;
  };
  if (!env) return load();
  // `null` is a legitimate cached value here (most workspaces never set defaults), and
  // getOrSetCached treats a cached null as a miss — so cache a discriminated wrapper.
  const cached = await getOrSetCached<{ row: TenantManagerDefaultsRow | null }>(
    env, tenantDefaultsCacheKey(tenantId), async () => ({ row: await load() }), { kvTtlSeconds: 600 },
  );
  return cached.row;
}

/** Editable subset of the workspace defaults. `null` clears a field back to "no opinion". */
export type TenantManagerDefaultsPatch = Partial<TenantManagerDefaultsRow>;

/**
 * Upsert a tenant's workspace manager defaults and invalidate the cached read. Only the
 * keys present in `patch` are written, so a caller can express one opinion without
 * accidentally pinning the others (which is the whole point of the nullable columns).
 */
export async function upsertTenantManagerDefaults(
  db: Db,
  tenantId: number,
  patch: TenantManagerDefaultsPatch,
  opts?: { updatedBy?: string | null; env?: Env },
): Promise<TenantManagerDefaultsRow | null> {
  const now = new Date();
  const normalized: TenantManagerDefaultsPatch = {
    ...patch,
    // An explicit garbage policy string must not be persisted; an explicit null (clear
    // the opinion) must survive.
    ...(patch.prMergePolicy !== undefined
      ? { prMergePolicy: patch.prMergePolicy === null ? null : normalizePrMergePolicy(patch.prMergePolicy) }
      : {}),
  };
  await db
    .insert(tenantManagerDefaults)
    .values({
      tenantId,
      enabled: normalized.enabled ?? null,
      prMergePolicy: normalized.prMergePolicy ?? null,
      autoAssign: normalized.autoAssign ?? null,
      autoBusinessValue: normalized.autoBusinessValue ?? null,
      autoPrioritize: normalized.autoPrioritize ?? null,
      autoSchedule: normalized.autoSchedule ?? null,
      requireSignoffToComplete: normalized.requireSignoffToComplete ?? null,
      allowAutoMerge: normalized.allowAutoMerge ?? null,
      allowUnattendedCeremonies: normalized.allowUnattendedCeremonies ?? null,
      allowAgentReassignment: normalized.allowAgentReassignment ?? null,
      agentReassignIdleHours: normalized.agentReassignIdleHours ?? null,
      agentReassignMaxPerSession: normalized.agentReassignMaxPerSession ?? null,
      allowAutoStaffLanes: normalized.allowAutoStaffLanes ?? null,
      updatedBy: opts?.updatedBy ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tenantManagerDefaults.tenantId,
      set: {
        ...(normalized.enabled !== undefined ? { enabled: normalized.enabled } : {}),
        ...(normalized.prMergePolicy !== undefined ? { prMergePolicy: normalized.prMergePolicy } : {}),
        ...(normalized.autoAssign !== undefined ? { autoAssign: normalized.autoAssign } : {}),
        ...(normalized.autoBusinessValue !== undefined ? { autoBusinessValue: normalized.autoBusinessValue } : {}),
        ...(normalized.autoPrioritize !== undefined ? { autoPrioritize: normalized.autoPrioritize } : {}),
        ...(normalized.autoSchedule !== undefined ? { autoSchedule: normalized.autoSchedule } : {}),
        ...(normalized.requireSignoffToComplete !== undefined ? { requireSignoffToComplete: normalized.requireSignoffToComplete } : {}),
        ...(normalized.allowAutoMerge !== undefined ? { allowAutoMerge: normalized.allowAutoMerge } : {}),
        ...(normalized.allowUnattendedCeremonies !== undefined ? { allowUnattendedCeremonies: normalized.allowUnattendedCeremonies } : {}),
        ...(normalized.allowAgentReassignment !== undefined ? { allowAgentReassignment: normalized.allowAgentReassignment } : {}),
        ...(normalized.agentReassignIdleHours !== undefined ? { agentReassignIdleHours: normalized.agentReassignIdleHours } : {}),
        ...(normalized.agentReassignMaxPerSession !== undefined ? { agentReassignMaxPerSession: normalized.agentReassignMaxPerSession } : {}),
        ...(normalized.allowAutoStaffLanes !== undefined ? { allowAutoStaffLanes: normalized.allowAutoStaffLanes } : {}),
        ...(opts?.updatedBy !== undefined ? { updatedBy: opts.updatedBy } : {}),
        updatedAt: now,
      },
    });
  if (opts?.env) await invalidateCached(opts.env, tenantDefaultsCacheKey(tenantId));
  return getTenantManagerDefaults(db, tenantId);
}

/**
 * The EFFECTIVE policy for a project — the full three-tier fold
 * (hardcoded default ← workspace defaults ← project row), resolved by the one shared
 * pure function. `env` is optional so unit/legacy callers still work; when supplied the
 * workspace row is served from the read-through cache.
 */
export async function getEffectiveManagerPolicy(
  db: Db, tenantId: number, projectId: number, env?: Env,
): Promise<EffectiveManagerPolicy> {
  return (await getProjectManagerState(db, tenantId, projectId, env)).policy;
}

/**
 * The policy AND whether this project is managed at all, from the same pair of reads.
 *
 * Two separate calls would be two answers to one question and a second round-trip to get
 * them out of step with: `managed` is not derivable from the policy alone, because the
 * fold cannot tell "this project has no row" from "this project has a row that agrees
 * with every default" — both resolve to `enabled: true`. Only the raw row distinguishes
 * them, and that distinction IS the opt-in (see {@link isProjectManaged}).
 */
export async function getProjectManagerState(
  db: Db, tenantId: number, projectId: number, env?: Env,
): Promise<{ policy: EffectiveManagerPolicy; configured: boolean; managed: boolean; lastRunAt: Date | null }> {
  const [tenant, project] = await Promise.all([
    getTenantManagerDefaults(db, tenantId, env),
    getManagerConfigRow(db, tenantId, projectId),
  ]);
  return {
    policy: resolveTieredManagerPolicy({ tenant, project }),
    configured: !!project,
    managed: isProjectManaged({ tenant, project }),
    // WHEN THE PREVIOUS PASS ENDED — handed back from the row this read already holds,
    // so it costs nothing. The pass needs it to attribute the merges the PR merge sweep
    // journalled since then (see `countPrMergesSince`); reading it separately would be a
    // second round-trip for a column already in hand.
    lastRunAt: project?.lastRunAt ?? null,
  };
}

/** Upsert a project's manager config (the designation + policy). */
export async function upsertManagerConfig(
  db: Db,
  tenantId: number,
  projectId: number,
  patch: Partial<Pick<ManagerConfigRow, 'managerRef' | 'enabled' | 'prMergePolicy' | 'autoAssign' | 'autoBusinessValue' | 'autoPrioritize' | 'autoSchedule' | 'managerType' | 'requireSignoffToComplete' | 'allowAutoMerge' | 'allowUnattendedCeremonies' | 'allowAgentReassignment' | 'agentReassignIdleHours' | 'agentReassignMaxPerSession' | 'allowAutoStaffLanes'>>,
): Promise<ManagerConfigRow> {
  const now = new Date();
  await db
    .insert(projectManagerConfigs)
    .values({
      tenantId, projectId,
      managerRef: patch.managerRef ?? null,
      enabled: patch.enabled ?? true,
      prMergePolicy: patch.prMergePolicy ?? 'immediate',
      autoAssign: patch.autoAssign ?? true,
      autoBusinessValue: patch.autoBusinessValue ?? true,
      autoPrioritize: patch.autoPrioritize ?? true,
      // Default TRUE on insert, like its grooming siblings (0364): scheduling only ever
      // fills tickets with NO dates and never overwrites a human's, so a newly-configured
      // project gains a timeline rather than another empty column.
      autoSchedule: patch.autoSchedule ?? true,
      managerType: normalizeManagerType(patch.managerType),
      // Default OFF on insert (0380) — from the shared constant, so the hardcoded floor of
      // the fold and the value a fresh row materialises with can never drift apart. A
      // review gate is something a project turns ON; inventing one for a project that
      // never asked is what left tickets waiting 48 days on sign-offs nobody owed.
      requireSignoffToComplete: patch.requireSignoffToComplete ?? DEFAULT_MANAGER_POLICY.requireSignoffToComplete,
      // Default NULL on insert = "inherit the workspace tier" (0363). Writing `false`
      // here would pin a brand-new project against a workspace-wide grant it should have
      // received; writing `true` would grant authority nobody asked for.
      allowAutoMerge: patch.allowAutoMerge ?? null,
      // Ceremony autonomy (0364) — NULL on insert for the same reason as allowAutoMerge:
      // a brand-new project has never had an opinion about whether its standups may run
      // without its people, and an ADD COLUMN default would invent one.
      allowUnattendedCeremonies: patch.allowUnattendedCeremonies ?? null,
      allowAgentReassignment: patch.allowAgentReassignment ?? null,
      agentReassignIdleHours: patch.agentReassignIdleHours ?? null,
      agentReassignMaxPerSession: patch.agentReassignMaxPerSession ?? null,
      // 0386 — NULL on insert for the same reason as the two above: a brand-new project
      // has never had an opinion about whether the manager may configure a lane for it.
      allowAutoStaffLanes: patch.allowAutoStaffLanes ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [projectManagerConfigs.tenantId, projectManagerConfigs.projectId],
      set: {
        ...(patch.managerRef !== undefined ? { managerRef: patch.managerRef } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.prMergePolicy !== undefined ? { prMergePolicy: patch.prMergePolicy } : {}),
        ...(patch.autoAssign !== undefined ? { autoAssign: patch.autoAssign } : {}),
        ...(patch.autoBusinessValue !== undefined ? { autoBusinessValue: patch.autoBusinessValue } : {}),
        ...(patch.autoPrioritize !== undefined ? { autoPrioritize: patch.autoPrioritize } : {}),
        ...(patch.autoSchedule !== undefined ? { autoSchedule: patch.autoSchedule } : {}),
        ...(patch.managerType !== undefined ? { managerType: normalizeManagerType(patch.managerType) } : {}),
        ...(patch.requireSignoffToComplete !== undefined ? { requireSignoffToComplete: patch.requireSignoffToComplete } : {}),
        ...(patch.allowAutoMerge !== undefined ? { allowAutoMerge: patch.allowAutoMerge } : {}),
        ...(patch.allowUnattendedCeremonies !== undefined ? { allowUnattendedCeremonies: patch.allowUnattendedCeremonies } : {}),
        ...(patch.allowAgentReassignment !== undefined ? { allowAgentReassignment: patch.allowAgentReassignment } : {}),
        ...(patch.agentReassignIdleHours !== undefined ? { agentReassignIdleHours: patch.agentReassignIdleHours } : {}),
        ...(patch.agentReassignMaxPerSession !== undefined ? { agentReassignMaxPerSession: patch.agentReassignMaxPerSession } : {}),
        ...(patch.allowAutoStaffLanes !== undefined ? { allowAutoStaffLanes: patch.allowAutoStaffLanes } : {}),
        updatedAt: now,
      },
    });
  return (await getManagerConfigRow(db, tenantId, projectId))!;
}
