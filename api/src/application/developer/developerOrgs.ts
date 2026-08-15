/**
 * Publishers — registration, membership and verification.
 *
 * The route layer owns HTTP; this owns the two tables. Nothing here is
 * tenant-scoped, and that is the design rather than an oversight: a publisher is
 * not our customer (PRD 24 §5.1), so reaching one goes through MEMBERSHIP —
 * `developer_org_members.user_id` — not through the caller's workspace. The
 * argument is written out in `schema/integrations.ts` and declared to the tenancy
 * guard in `check-tenant-column.mjs`.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { developerOrgMembers, developerOrgs } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  isVerificationState,
  roleAtLeast,
  type DeveloperRole,
  type DeveloperVerificationState,
} from './extensionContract';

export class DeveloperOrgError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
    this.name = 'DeveloperOrgError';
  }
}

export interface DeveloperOrgView {
  id: string;
  slug: string;
  legalName: string;
  website: string | null;
  supportEmail: string | null;
  verificationState: DeveloperVerificationState | string;
  verificationDomain: string | null;
  verifiedAt: string | null;
  suspended: boolean;
  createdAt: string | null;
}

type Row = typeof developerOrgs.$inferSelect;

/** The publisher as the portal and the public listing both see it. The
 *  verification TOKEN is never projected — it is a challenge, not a fact. */
export function toDeveloperOrgView(row: Row): DeveloperOrgView {
  return {
    id: row.id,
    slug: row.slug,
    legalName: row.legalName,
    website: row.website,
    supportEmail: row.supportEmail,
    verificationState: row.verificationState,
    verificationDomain: row.verificationDomain,
    verifiedAt: row.verifiedAt ? new Date(row.verifiedAt).toISOString() : null,
    suspended: row.suspendedAt !== null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  };
}

/** `Acme Payroll, Inc.` → `acme-payroll-inc`. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const membershipCacheKey = (userId: string): string => `developer:orgs:user:${userId}`;

/** Drop a user's cached membership list. Call after ANY membership or org write. */
export async function invalidateDeveloperMembership(env: Env, userIds: string[]): Promise<void> {
  await Promise.all(userIds.map((id) => invalidateCached(env, membershipCacheKey(id))));
}

/**
 * Register a publisher and make the creating user its owner.
 *
 * Slug collisions are a 409 rather than a silent suffix: the slug is the URL a
 * vendor will print on their own site, so handing them a different one than they
 * asked for is worse than making them choose again.
 */
export async function createDeveloperOrg(
  db: Db,
  env: Env,
  input: { userId: string; legalName: string; slug?: string; website?: string | null; supportEmail?: string | null },
): Promise<DeveloperOrgView> {
  const legalName = input.legalName.trim();
  if (legalName.length < 2) throw new DeveloperOrgError('legalName is required');

  const slug = slugify(input.slug?.trim() || legalName);
  if (slug.length < 2) throw new DeveloperOrgError('slug must be at least 2 characters');

  const [existing] = await db.select({ id: developerOrgs.id }).from(developerOrgs).where(eq(developerOrgs.slug, slug)).limit(1);
  if (existing) throw new DeveloperOrgError(`the slug "${slug}" is taken`, 409);

  const [row] = await db
    .insert(developerOrgs)
    .values({
      slug,
      legalName,
      website: input.website?.trim() || null,
      supportEmail: input.supportEmail?.trim() || null,
    })
    .returning();
  if (!row) throw new DeveloperOrgError('failed to register publisher', 409);

  await db.insert(developerOrgMembers).values({
    developerOrgId: row.id,
    userId: input.userId,
    role: 'owner',
  });

  await invalidateDeveloperMembership(env, [input.userId]);
  return toDeveloperOrgView(row);
}

export interface DeveloperMembership {
  org: DeveloperOrgView;
  role: DeveloperRole | string;
}

/**
 * Every publisher this user may act for.
 *
 * Read-through cached: the portal asks on every page load and the answer changes
 * only when somebody joins, leaves or registers — all of which invalidate.
 */
export async function listMembershipsForUser(db: Db, env: Env, userId: string): Promise<DeveloperMembership[]> {
  return getOrSetCached(
    env,
    membershipCacheKey(userId),
    async () => {
      const memberships = await db
        .select({ orgId: developerOrgMembers.developerOrgId, role: developerOrgMembers.role })
        .from(developerOrgMembers)
        .where(eq(developerOrgMembers.userId, userId));
      if (memberships.length === 0) return [];

      // One `IN` rather than a query per membership — a publisher with five orgs
      // must not cost five round-trips on every portal load.
      const orgs = await db
        .select()
        .from(developerOrgs)
        .where(inArray(developerOrgs.id, memberships.map((m) => m.orgId)));
      const byId = new Map(orgs.map((o) => [o.id, o]));

      return memberships
        .map((m) => {
          const org = byId.get(m.orgId);
          return org ? { org: toDeveloperOrgView(org), role: m.role } : null;
        })
        .filter((m): m is DeveloperMembership => m !== null);
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

/**
 * Resolve the caller's authority over one publisher, or throw.
 *
 * ONE gate, used by every write path in this context. A route that decided for
 * itself whether a `publisher` may suspend an org is exactly the duplicated
 * branch that ends up saying yes in one place and no in another.
 */
export async function requireMembership(
  db: Db,
  orgId: string,
  userId: string,
  minimumRole: DeveloperRole,
): Promise<{ org: Row; role: DeveloperRole | string }> {
  const [org] = await db.select().from(developerOrgs).where(eq(developerOrgs.id, orgId)).limit(1);
  if (!org) throw new DeveloperOrgError('publisher not found', 404);

  const [member] = await db
    .select({ role: developerOrgMembers.role })
    .from(developerOrgMembers)
    .where(and(eq(developerOrgMembers.developerOrgId, orgId), eq(developerOrgMembers.userId, userId)))
    .limit(1);
  if (!member) throw new DeveloperOrgError('you are not a member of this publisher', 403);
  if (!roleAtLeast(member.role, minimumRole)) {
    throw new DeveloperOrgError(`this action requires the ${minimumRole} role`, 403);
  }
  if (org.suspendedAt && minimumRole !== 'owner') {
    throw new DeveloperOrgError('this publisher is suspended', 403);
  }
  return { org, role: member.role };
}

/** Add a member. Requires `admin`; only an owner may mint another owner. */
export async function addMember(
  db: Db,
  env: Env,
  input: { orgId: string; actorUserId: string; userId: string; role: DeveloperRole },
): Promise<void> {
  const { role: actorRole } = await requireMembership(db, input.orgId, input.actorUserId, 'admin');
  if (input.role === 'owner' && !roleAtLeast(actorRole, 'owner')) {
    throw new DeveloperOrgError('only an owner may add another owner', 403);
  }
  await db
    .insert(developerOrgMembers)
    .values({ developerOrgId: input.orgId, userId: input.userId, role: input.role })
    .onConflictDoUpdate({
      target: [developerOrgMembers.developerOrgId, developerOrgMembers.userId],
      set: { role: input.role },
    });
  await invalidateDeveloperMembership(env, [input.userId]);
}

/** Remove a member. An org must keep at least one owner, or nobody can bill it. */
export async function removeMember(
  db: Db,
  env: Env,
  input: { orgId: string; actorUserId: string; userId: string },
): Promise<void> {
  await requireMembership(db, input.orgId, input.actorUserId, 'admin');
  const owners = await db
    .select({ userId: developerOrgMembers.userId })
    .from(developerOrgMembers)
    .where(and(eq(developerOrgMembers.developerOrgId, input.orgId), eq(developerOrgMembers.role, 'owner')));
  if (owners.length === 1 && owners[0]?.userId === input.userId) {
    throw new DeveloperOrgError('a publisher must keep at least one owner', 409);
  }
  await db
    .delete(developerOrgMembers)
    .where(and(eq(developerOrgMembers.developerOrgId, input.orgId), eq(developerOrgMembers.userId, input.userId)));
  await invalidateDeveloperMembership(env, [input.userId]);
}

/**
 * Start a domain claim. Returns the TXT record the publisher must publish.
 *
 * The token is generated here and stored; the value shown to the publisher is the
 * only place it appears in a response, because a token readable from the org
 * projection would let anyone who can see the listing complete somebody else's
 * claim.
 */
export async function beginDomainVerification(
  db: Db,
  env: Env,
  input: { orgId: string; actorUserId: string; domain: string },
): Promise<{ domain: string; recordName: string; recordValue: string }> {
  await requireMembership(db, input.orgId, input.actorUserId, 'admin');

  const domain = input.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) {
    throw new DeveloperOrgError('enter a domain like example.com');
  }

  const token = `bfdev-verify-${crypto.randomUUID().replace(/-/g, '')}`;
  await db
    .update(developerOrgs)
    .set({ verificationDomain: domain, verificationToken: token, updatedAt: new Date() })
    .where(eq(developerOrgs.id, input.orgId));

  await invalidateVerificationReaders(db, env, input.orgId);
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
export async function setVerificationState(
  db: Db,
  env: Env,
  input: { orgId: string; state: string },
): Promise<DeveloperOrgView> {
  if (!isVerificationState(input.state)) throw new DeveloperOrgError('unknown verification state');
  const [row] = await db
    .update(developerOrgs)
    .set({
      verificationState: input.state,
      verifiedAt: input.state === 'unverified' ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(developerOrgs.id, input.orgId))
    .returning();
  if (!row) throw new DeveloperOrgError('publisher not found', 404);
  await invalidateVerificationReaders(db, env, input.orgId);
  return toDeveloperOrgView(row);
}

/** Suspend or restore a publisher. Hides every listing at once — see `listPackages`. */
export async function setSuspended(
  db: Db,
  env: Env,
  input: { orgId: string; suspended: boolean; reason?: string | null },
): Promise<DeveloperOrgView> {
  const [row] = await db
    .update(developerOrgs)
    .set({
      suspendedAt: input.suspended ? new Date() : null,
      suspendedReason: input.suspended ? (input.reason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(developerOrgs.id, input.orgId))
    .returning();
  if (!row) throw new DeveloperOrgError('publisher not found', 404);
  await invalidateVerificationReaders(db, env, input.orgId);
  return toDeveloperOrgView(row);
}

/** Get one publisher by id. Used by the listing projection. */
export async function getDeveloperOrg(db: Db, orgId: string): Promise<DeveloperOrgView | null> {
  const [row] = await db.select().from(developerOrgs).where(eq(developerOrgs.id, orgId)).limit(1);
  return row ? toDeveloperOrgView(row) : null;
}

/**
 * Everything that caches a fact about this publisher goes stale together.
 *
 * Its members' membership lists carry the org projection (verification badge,
 * suspension), so a verification change that dropped only the org row would leave
 * every member's portal showing yesterday's badge for five minutes.
 */
async function invalidateVerificationReaders(db: Db, env: Env, orgId: string): Promise<void> {
  const members = await db
    .select({ userId: developerOrgMembers.userId })
    .from(developerOrgMembers)
    .where(eq(developerOrgMembers.developerOrgId, orgId));
  await invalidateDeveloperMembership(env, members.map((m) => m.userId));
}
