/**
 * leaseService — the ONE place a resource lease is acquired, renewed or released.
 *
 * The concurrency primitive is the partial unique index from migration 0370
 * (`(tenant_id, resource_key) WHERE released_at IS NULL`). Acquire is therefore an
 * `INSERT … ON CONFLICT DO NOTHING`: if it inserts, the lease is ours; if it inserts
 * nothing, someone else holds it. That is an atomic test-and-set with no advisory lock
 * and no interactive transaction — which matters, because neon-http has neither.
 *
 * CONTAINMENT costs one extra read. A claim on `src/api/routes.ts` must also be clear
 * of `src/api`, `src` and the repo root, so we read the live leases for the whole
 * ancestor set (an indexed `IN (…)`) and apply the pure rules in
 * domain/coordination/resourceKey.ts before attempting the insert. A conflicting
 * ancestor short-circuits; the insert then re-checks the exact key atomically, so the
 * read is an optimisation and a better error message, never the safety property.
 *
 * CACHING. Deliberately uncached on the WRITE path — a lock served from a 30-second
 * cache is not a lock. The read-only `listLeases` used by the UI and by
 * `workspace_read` IS cached (read-through, per-scope version token bumped on every
 * lease mutation), because that one is a display, not an arbiter.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { LeaseClaimResult, LeaseInfo, LeaseListResult, LeaseMode, LeaseReleaseResult } from '@builderforce/agent-tools';
import {
  LEASE_TTL_SECONDS,
  conflictKeysFor,
  coordinationScopeKey,
  findBlockingLease,
  normalizeResourcePath,
  resourceKeyFor,
  type LeaseLike,
} from '../../domain/coordination/resourceKey';
import { resourceLeases } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** Identity of the run asking for a lease. */
export interface LeaseHolder {
  tenantId: number;
  executionId: number | null;
  label: string;
  taskId: number | null;
  /** `owner/name` of the repo the run is working, or '' when none is bound. */
  repoSlug: string;
  scopeKey: string;
}

const LEASE_LIST_L1_TTL_MS = 5_000;
const versionKey = (tenantId: number, scopeKey: string): string => `lease:ver:${tenantId}:${scopeKey}`;

async function invalidateScope(env: Env, tenantId: number, scopeKey: string): Promise<void> {
  await bumpCacheVersion(env, versionKey(tenantId, scopeKey));
}

/** Live leases for the given canonical keys, as the pure conflict rules want them. */
async function liveLeasesFor(db: Db, tenantId: number, keys: string[]): Promise<LeaseLike[]> {
  if (keys.length === 0) return [];
  const rows = await db
    .select({
      resourceKey: resourceLeases.resourceKey,
      mode: resourceLeases.mode,
      executionId: resourceLeases.executionId,
      expiresAt: resourceLeases.expiresAt,
      releasedAt: resourceLeases.releasedAt,
      holderLabel: resourceLeases.holderLabel,
      reason: resourceLeases.reason,
    })
    .from(resourceLeases)
    .where(and(eq(resourceLeases.tenantId, tenantId), inArray(resourceLeases.resourceKey, keys), isNull(resourceLeases.releasedAt)));
  return rows.map((r) => ({
    resourceKey: r.resourceKey,
    mode: r.mode as LeaseMode,
    executionId: r.executionId,
    expiresAt: r.expiresAt,
    releasedAt: r.releasedAt,
    holderLabel: r.holderLabel,
    reason: r.reason,
  })) as Array<LeaseLike & { holderLabel: string; reason: string | null }>;
}

/**
 * Take (or renew) a lease. Never throws: a DB failure degrades to `ok:false`, and the
 * CALLER decides what that means — the tool reports it to the model, while the write
 * guard treats an un-grantable lease as "let the write through", because losing the
 * ability to lock must not become an inability to work (fail-open on infrastructure,
 * fail-closed on a real conflict).
 */
export async function acquireLease(
  env: Env,
  db: Db,
  holder: LeaseHolder,
  resource: string,
  opts?: { mode?: LeaseMode; reason?: string; ttlSeconds?: number },
): Promise<LeaseClaimResult> {
  const mode: LeaseMode = opts?.mode === 'shared' ? 'shared' : 'exclusive';
  const path = normalizeResourcePath(resource);
  const key = resourceKeyFor(holder.repoSlug, path);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (opts?.ttlSeconds ?? LEASE_TTL_SECONDS) * 1000);

  try {
    // 1. Containment check across the ancestor set (most specific first).
    const keys = conflictKeysFor(holder.repoSlug, path);
    const existing = (await liveLeasesFor(db, holder.tenantId, keys)) as Array<
      LeaseLike & { holderLabel: string; reason: string | null }
    >;
    const blocking = findBlockingLease(existing, holder.executionId, mode, now) as
      | (LeaseLike & { holderLabel: string; reason: string | null })
      | null;
    if (blocking) {
      return {
        ok: true,
        resource: path,
        granted: false,
        heldBy: blocking.holderLabel,
        expiresAt: blocking.expiresAt.toISOString(),
        note:
          `'${path}' is held by ${blocking.holderLabel}`
          + `${blocking.reason ? ` (${blocking.reason})` : ''}`
          + `${blocking.resourceKey !== key ? ` via a lease on the enclosing '${blocking.resourceKey.split(':').slice(2).join(':')}'` : ''}`
          + '. Work on something else, or post a workspace_note explaining what you need from them.',
      };
    }

    // 2. Renewal: we already hold this exact key — extend rather than insert.
    const mine = existing.find((l) => l.resourceKey === key && holder.executionId !== null && l.executionId === holder.executionId);
    if (mine) {
      await db
        .update(resourceLeases)
        .set({ expiresAt, mode, ...(opts?.reason ? { reason: opts.reason } : {}) })
        .where(
          and(
            eq(resourceLeases.tenantId, holder.tenantId),
            eq(resourceLeases.resourceKey, key),
            isNull(resourceLeases.releasedAt),
          ),
        );
      await invalidateScope(env, holder.tenantId, holder.scopeKey);
      return { ok: true, resource: path, mode, granted: true, expiresAt: expiresAt.toISOString(), note: 'lease renewed' };
    }

    // 3. Reap an EXPIRED holder of this exact key so the insert below can win. Scoped
    //    to expired rows only, so a live lease is never stolen by this path.
    await db
      .update(resourceLeases)
      .set({ releasedAt: now })
      .where(
        and(
          eq(resourceLeases.tenantId, holder.tenantId),
          eq(resourceLeases.resourceKey, key),
          isNull(resourceLeases.releasedAt),
          sql`${resourceLeases.expiresAt} <= ${now}`,
        ),
      );

    // 4. The atomic test-and-set. `DO NOTHING` + `returning` means: rows back = we won.
    const inserted = await db
      .insert(resourceLeases)
      .values({
        tenantId: holder.tenantId,
        resourceKey: key,
        mode,
        scopeKey: holder.scopeKey,
        executionId: holder.executionId,
        holderLabel: holder.label,
        taskId: holder.taskId,
        reason: opts?.reason ?? null,
        acquiredAt: now,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: resourceLeases.id });

    if (inserted.length === 0) {
      // Lost the race between the read and the insert — report the winner.
      const [winner] = (await liveLeasesFor(db, holder.tenantId, [key])) as Array<LeaseLike & { holderLabel: string }>;
      return {
        ok: true,
        resource: path,
        granted: false,
        heldBy: winner?.holderLabel ?? 'another agent',
        note: `'${path}' was claimed by another agent a moment ago. Pick different work or coordinate with a workspace_note.`,
      };
    }

    await invalidateScope(env, holder.tenantId, holder.scopeKey);
    return { ok: true, resource: path, mode, granted: true, expiresAt: expiresAt.toISOString() };
  } catch (e) {
    return { ok: false, resource: path, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Release one lease this run holds. Releasing something it does not hold is a no-op. */
export async function releaseLease(env: Env, db: Db, holder: LeaseHolder, resource: string): Promise<LeaseReleaseResult> {
  const path = normalizeResourcePath(resource);
  const key = resourceKeyFor(holder.repoSlug, path);
  try {
    const released = await db
      .update(resourceLeases)
      .set({ releasedAt: new Date() })
      .where(
        and(
          eq(resourceLeases.tenantId, holder.tenantId),
          eq(resourceLeases.resourceKey, key),
          isNull(resourceLeases.releasedAt),
          holder.executionId === null ? sql`TRUE` : eq(resourceLeases.executionId, holder.executionId),
        ),
      )
      .returning({ id: resourceLeases.id });
    if (released.length > 0) await invalidateScope(env, holder.tenantId, holder.scopeKey);
    return { ok: true, resource: path, released: released.length > 0 };
  } catch (e) {
    return { ok: false, resource: path, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Release EVERY lease a run holds. Called from the engine when a run reaches a terminal
 * state, so a finished agent never keeps a path locked until the TTL lapses. Best-effort:
 * the TTL is the backstop if this fails.
 */
export async function releaseAllForExecution(
  env: Env,
  db: Db,
  tenantId: number,
  executionId: number,
  scopeKey?: string,
): Promise<number> {
  try {
    const released = await db
      .update(resourceLeases)
      .set({ releasedAt: new Date() })
      .where(
        and(eq(resourceLeases.tenantId, tenantId), eq(resourceLeases.executionId, executionId), isNull(resourceLeases.releasedAt)),
      )
      .returning({ id: resourceLeases.id });
    if (released.length > 0 && scopeKey) await invalidateScope(env, tenantId, scopeKey);
    return released.length;
  } catch {
    return 0;
  }
}

/**
 * Force-release one lease by resource, whoever holds it. The operator escape hatch for
 * the case the TTL cannot fix fast enough: a holder is known dead and live agents are
 * queued behind it. Takes the RAW resource string and canonicalises it here, so the
 * caller never has to construct (or be trusted with) a lease key.
 */
export async function forceReleaseLease(
  env: Env,
  db: Db,
  args: { tenantId: number; taskId: number; resource: string; repoSlug?: string },
): Promise<number> {
  const key = resourceKeyFor(args.repoSlug ?? '', args.resource);
  const scopeKey = coordinationScopeKey(args.taskId);
  const released = await db
    .update(resourceLeases)
    .set({ releasedAt: new Date() })
    .where(
      scopedToTenant(
        resourceLeases,
        args.tenantId,
        eq(resourceLeases.scopeKey, scopeKey),
        eq(resourceLeases.resourceKey, key),
        isNull(resourceLeases.releasedAt),
      ),
    )
    .returning({ id: resourceLeases.id })
    .catch(() => [] as Array<{ id: string }>);
  if (released.length > 0) await invalidateScope(env, args.tenantId, scopeKey);
  return released.length;
}

/**
 * The live leases in one coordination scope — what `workspace_read` and the UI show.
 * Read-through cached behind a per-scope version token (bumped by every mutation
 * above), with a short L1 so a burst of tool calls in one run costs one query.
 */
export async function listLeases(
  env: Env,
  db: Db,
  tenantId: number,
  scopeKey: string,
  viewerExecutionId?: number | null,
): Promise<LeaseListResult> {
  try {
    const ver = await getCacheVersion(env, versionKey(tenantId, scopeKey));
    const rows = await getOrSetCached(
      env,
      `lease:list:${tenantId}:${scopeKey}:${ver}`,
      async () =>
        db
          .select({
            resourceKey: resourceLeases.resourceKey,
            mode: resourceLeases.mode,
            holderLabel: resourceLeases.holderLabel,
            executionId: resourceLeases.executionId,
            reason: resourceLeases.reason,
            expiresAt: resourceLeases.expiresAt,
          })
          .from(resourceLeases)
          .where(and(eq(resourceLeases.tenantId, tenantId), eq(resourceLeases.scopeKey, scopeKey), isNull(resourceLeases.releasedAt))),
      { l1TtlMs: LEASE_LIST_L1_TTL_MS },
    );
    const now = Date.now();
    // Expiry is applied on READ as well as by the reaper: a lapsed lease must stop
    // being reported the moment it lapses, not when something happens to sweep it.
    const leases: LeaseInfo[] = rows
      .map((r) => ({ ...r, expiresAtDate: new Date(r.expiresAt) }))
      .filter((r) => r.expiresAtDate.getTime() > now)
      .map((r) => ({
        resource: r.resourceKey.split(':').slice(2).join(':'),
        mode: r.mode as LeaseMode,
        holder: r.holderLabel,
        mine: viewerExecutionId != null && r.executionId === viewerExecutionId,
        reason: r.reason,
        expiresAt: r.expiresAtDate.toISOString(),
      }));
    return { ok: true, leases };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
