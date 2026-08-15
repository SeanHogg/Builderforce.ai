/**
 * Publishers — becoming one, verifying one, standing one down.
 *
 * ── A DEVELOPER IS A TENANT (migration 0472) ────────────────────────────────
 * This module used to own two tables. `developer_orgs` was a party model beside
 * the one that already existed, and `developer_org_members` was its staff list —
 * `tenant_members` with the tenant taken out, which is what `check-shape-lint`
 * had been saying about it since the day it landed.
 *
 * Now a publisher IS a workspace with `tenants.publisher_state <> 'none'`. That
 * removes a whole class of question rather than answering it: there is no second
 * membership to keep in sync, no second role ladder to disagree with the first, no
 * "which of my orgs am I acting as?" selector, and no way for a vendor's engineer
 * to be inside the company but outside the publisher. Adding a colleague to the
 * publisher is adding them to the workspace, in the one place workspace membership
 * has always been managed — which is why this module has no member endpoints at
 * all any more.
 *
 * What it costs is the case 0467 was built for: a publisher who is not our
 * customer. That case is still expressible — a free workspace that publishes — it
 * simply is not a different KIND of thing.
 *
 * The route layer owns HTTP; this owns the facet. Authority comes from
 * `application/tenant/tenantRoles.ts`, so a publisher action is gated by the same
 * ladder as every other workspace action.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tenants } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { tenantRoleOf, tenantRoleAtLeast, type TenantRole } from '../tenant/tenantRoles';
import { isPublisherState, publishes, type PublisherState } from './extensionContract';

export class PublisherError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
    this.name = 'PublisherError';
  }
}

/**
 * The publisher as the portal and the public listing both see it.
 *
 * The verification TOKEN is never projected — it is a challenge, not a fact, and
 * one readable from a listing would let anyone finish somebody else's claim.
 */
export interface PublisherView {
  /** The workspace. There is no separate publisher id, and that is the point. */
  tenantId: number;
  slug: string;
  name: string;
  website: string | null;
  supportEmail: string | null;
  state: PublisherState | string;
  domain: string | null;
  verifiedAt: string | null;
  suspended: boolean;
}

type TenantRow = typeof tenants.$inferSelect;

export function toPublisherView(row: TenantRow): PublisherView {
  return {
    tenantId: row.id,
    slug: row.slug,
    name: row.name,
    website: row.publisherWebsite,
    supportEmail: row.publisherSupportEmail,
    state: row.publisherState,
    domain: row.publisherDomain,
    verifiedAt: row.publisherVerifiedAt ? new Date(row.publisherVerifiedAt).toISOString() : null,
    suspended: row.publisherSuspendedAt !== null,
  };
}

const publisherCacheKey = (tenantId: number): string => `publisher:tenant:${tenantId}`;

/** Drop the cached facet. Call after ANY write to a publisher column. */
export async function invalidatePublisher(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, publisherCacheKey(tenantId));
}

/**
 * The caller's workspace as a publisher, or `null` when it does not publish.
 *
 * Read-through cached: the portal asks on every page load and the answer changes
 * only when somebody registers, verifies or is suspended — all of which
 * invalidate. Returning `null` for `'none'` rather than a row with a state field
 * means a consumer cannot forget to check: there is nothing to render.
 */
export async function publisherFor(db: Db, env: Env, tenantId: number): Promise<PublisherView | null> {
  // Cached as an ENVELOPE rather than as `PublisherView | null`. `getOrSetCached`
  // reads KV with `cached != null`, so a bare `null` round-trips as a MISS and
  // every non-publisher workspace — which is nearly all of them — would re-query
  // on each isolate. Wrapping it means "no, this workspace does not publish" is a
  // cached answer like any other.
  const { publisher } = await getOrSetCached(
    env,
    publisherCacheKey(tenantId),
    async (): Promise<{ publisher: PublisherView | null }> => {
      const row = await loadTenant(db, tenantId);
      return { publisher: publishes(row.publisherState) ? toPublisherView(row) : null };
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
  return publisher;
}

/**
 * Turn this workspace into a publisher.
 *
 * Idempotent on a workspace that already publishes: registering twice is a person
 * pressing a button twice, not an error worth a 409. It does NOT reset the
 * verification state, because that would let a second press quietly undo a
 * verification the first one earned.
 *
 * There is no slug to choose and no legal name to enter — the workspace already
 * has both, and asking again would create the drift where `/developers/acme`
 * belongs to a workspace called something else.
 */
export async function becomePublisher(
  db: Db,
  env: Env,
  input: { tenantId: number; userId: string; website?: string | null; supportEmail?: string | null },
): Promise<PublisherView> {
  await requirePublisherRole(db, input.tenantId, input.userId, 'manager');

  const current = await loadTenant(db, input.tenantId);
  const [row] = await db
    .update(tenants)
    .set({
      publisherState: publishes(current.publisherState) ? current.publisherState : 'unverified',
      publisherWebsite: input.website?.trim() || current.publisherWebsite,
      publisherSupportEmail: input.supportEmail?.trim() || current.publisherSupportEmail,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, input.tenantId))
    .returning();
  if (!row) throw new PublisherError('workspace not found', 404);

  await invalidatePublisher(env, input.tenantId);
  return toPublisherView(row);
}

/**
 * Resolve the caller's authority over this workspace's publishing, or throw.
 *
 * ONE gate, used by every write path in this context. A route that decided for
 * itself whether a `developer` may delist is exactly the duplicated branch that
 * ends up saying yes in one place and no in another.
 *
 * A SUSPENDED publisher is frozen below `owner`: standing a vendor down has to
 * stop them shipping, but an owner must still be able to see and correct the
 * listing that caused it.
 */
export async function requirePublisherRole(
  db: Db,
  tenantId: number,
  userId: string,
  minimum: TenantRole,
): Promise<{ tenant: TenantRow; role: TenantRole }> {
  const tenant = await loadTenant(db, tenantId);
  const role = await tenantRoleOf(db, tenantId, userId);
  if (!role) throw new PublisherError('you are not a member of this workspace', 403);
  if (!tenantRoleAtLeast(role, minimum)) {
    throw new PublisherError(`this action requires the ${minimum} role`, 403);
  }
  if (tenant.publisherSuspendedAt && minimum !== 'owner') {
    throw new PublisherError('this publisher is suspended', 403);
  }
  return { tenant, role };
}

/**
 * The same gate, plus the requirement that the workspace actually publishes.
 *
 * Separate from the above because `becomePublisher` needs the authority check
 * WITHOUT the publisher check — it is the call that makes one.
 */
export async function requirePublisher(
  db: Db,
  tenantId: number,
  userId: string,
  minimum: TenantRole,
): Promise<{ tenant: TenantRow; role: TenantRole }> {
  const resolved = await requirePublisherRole(db, tenantId, userId, minimum);
  if (!publishes(resolved.tenant.publisherState)) {
    throw new PublisherError('this workspace is not registered as a publisher', 403);
  }
  return resolved;
}

/**
 * Start a domain claim. Returns the TXT record the publisher must publish.
 *
 * The token is generated here and stored; the value returned is the only place it
 * ever appears in a response.
 */
export async function beginDomainVerification(
  db: Db,
  env: Env,
  input: { tenantId: number; userId: string; domain: string },
): Promise<{ domain: string; recordName: string; recordValue: string }> {
  await requirePublisher(db, input.tenantId, input.userId, 'manager');

  const domain = input.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) {
    throw new PublisherError('enter a domain like example.com');
  }

  const token = `bfdev-verify-${crypto.randomUUID().replace(/-/g, '')}`;
  await db
    .update(tenants)
    .set({ publisherDomain: domain, publisherVerificationToken: token, updatedAt: new Date() })
    .where(eq(tenants.id, input.tenantId));

  await invalidatePublisher(env, input.tenantId);
  return { domain, recordName: `_builderforce.${domain}`, recordValue: token };
}

/**
 * Record the outcome of a verification.
 *
 * Deliberately does NOT perform the DNS lookup itself. Phase 1 promotes on an
 * operator decision, and the DNS check is the same shape whether it is run by a
 * scheduled sweep or by an admin clicking "check now" — so the state transition
 * lives here, alone, and the thing that CALLS it can change without this moving.
 */
export async function setPublisherState(
  db: Db,
  env: Env,
  input: { tenantId: number; state: string },
): Promise<PublisherView> {
  if (!isPublisherState(input.state)) throw new PublisherError('unknown publisher state');
  const [row] = await db
    .update(tenants)
    .set({
      publisherState: input.state,
      publisherVerifiedAt: publishes(input.state) && input.state !== 'unverified' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, input.tenantId))
    .returning();
  if (!row) throw new PublisherError('workspace not found', 404);
  await invalidatePublisher(env, input.tenantId);
  return toPublisherView(row);
}

/** Suspend or restore a publisher. Hides every listing at once — see `listPublicCatalog`. */
export async function setPublisherSuspended(
  db: Db,
  env: Env,
  input: { tenantId: number; suspended: boolean; reason?: string | null },
): Promise<PublisherView> {
  const [row] = await db
    .update(tenants)
    .set({
      publisherSuspendedAt: input.suspended ? new Date() : null,
      publisherSuspendedReason: input.suspended ? (input.reason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, input.tenantId))
    .returning();
  if (!row) throw new PublisherError('workspace not found', 404);
  await invalidatePublisher(env, input.tenantId);
  return toPublisherView(row);
}

/**
 * The workspace row.
 *
 * `tenants` is the tenant itself, so it is addressed by primary key rather than
 * through `scopedToTenant` — the id IS the scope, and there is no wider set for a
 * predicate to narrow. Not exported: everything outside this module wants the
 * projection or the gate, never the forty-column row.
 */
async function loadTenant(db: Db, tenantId: number): Promise<TenantRow> {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!row) throw new PublisherError('workspace not found', 404);
  return row;
}
