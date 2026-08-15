/**
 * Publisher API keys (`bfai_*`) — mint, list, revoke and resolve.
 *
 * ── THE DRIFT THIS CLOSES ───────────────────────────────────────────────────
 * The key used to belong to a USER and carry no scopes, while `tenant_api_keys`
 * twenty lines away in the same schema module carried scopes AND an origin
 * allowlist. Two shapes for one concept — "a credential calling us from outside"
 * — with two middlewares and two answers to "what may this key do". A key that
 * outlived the engineer who minted it was also, literally, cascade-deleted with
 * their user row: a vendor's production integration, removed by an offboarding.
 *
 * So a key now belongs to a PUBLISHER (`developer_orgs`), `userId` records who
 * minted it, and the scope MECHANICS are the shared ones in
 * `application/shared/scopeList.ts`. Only the vocabulary is this module's.
 *
 * What did NOT come across is `allowed_origins`. A `bfai_*` key is a server
 * credential — a vendor's CI and their integration server — so an origin
 * allowlist would be a permanently-NULL column copied for symmetry. With it, the
 * two tables scored 0.68 on `check-signature-duplication` and genuinely WERE one
 * table; without it they are two credentials with two owners and two audiences.
 *
 * ── WHY AN EMPTY SCOPE LIST IS STILL UNRESTRICTED ───────────────────────────
 * Every key minted before migration 0467 has a NULL `scopes` column and is in
 * production use against `/api/v1/agents`. `hasScope` (the lenient form) is
 * therefore correct here, exactly as it is for tenant keys — while extension
 * INSTALL grants, which have no legacy, use the strict `requireScope`. The two
 * rules are different because the two populations are.
 */

import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { developerApiKeys, developerOrgMembers } from '../../infrastructure/database/schema';
import { generateApiKey, hashSecret } from '../../infrastructure/auth/HashService';
import { deserializeScopes, hasScope, serializeScopes } from '../shared/scopeList';
import { createDeveloperOrg, DeveloperOrgError, requireMembership } from './developerOrgs';

/**
 * What a publisher key may reach on `/api/v1/*`.
 *
 * Read-only today, because that is what the surface is. The point of declaring
 * the vocabulary now is that the NEXT endpoint has somewhere to state its
 * requirement, instead of a fourth unscoped route being added because there was
 * no list to add to.
 */
export const DEVELOPER_API_SCOPES = [
  'read:catalog',      // GET /api/v1/agents, /skills, /personas
  'read:installs',     // how many workspaces run this publisher's packages
  'write:packages',    // submit and publish versions from CI
] as const;
export type DeveloperApiScope = (typeof DEVELOPER_API_SCOPES)[number];

export interface DeveloperApiKeyRow {
  id: string;
  name: string;
  developerOrgId: string | null;
  scopes: string[] | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface MintedDeveloperKey extends DeveloperApiKeyRow {
  /** The raw key. Available at mint time and never again. */
  key: string;
}

/**
 * The publisher a user mints keys against, creating a personal one if they have
 * none.
 *
 * Auto-creation matters for continuity: migration 0467 backfilled exactly this
 * shape for every user who already held a key, so a developer who has never
 * heard of the portal gets the same behaviour they had before — they ask for a
 * key and get one. Making registration a prerequisite would have turned a
 * working endpoint into a two-step flow on deploy day.
 */
async function resolveOrgForUser(db: Db, env: Env, userId: string, displayName: string): Promise<string> {
  const [existing] = await db
    .select({ orgId: developerOrgMembers.developerOrgId })
    .from(developerOrgMembers)
    .where(eq(developerOrgMembers.userId, userId))
    .limit(1);
  if (existing) return existing.orgId;

  const org = await createDeveloperOrg(db, env, {
    userId,
    legalName: displayName || 'Developer',
    slug: `dev-${userId.replace(/-/g, '').slice(0, 16)}`,
  });
  return org.id;
}

function toRow(row: typeof developerApiKeys.$inferSelect): DeveloperApiKeyRow {
  return {
    id: row.id,
    name: row.name,
    developerOrgId: row.developerOrgId,
    scopes: deserializeScopes(row.scopes),
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

/** Mint a key for a publisher. Returns the raw key once; only its hash is stored. */
export async function mintDeveloperApiKey(
  db: Db,
  env: Env,
  input: {
    userId: string;
    displayName?: string;
    name: string;
    /** Explicit publisher. Omitted → the user's own, created on demand. */
    developerOrgId?: string | null;
    scopes?: string[] | null;
  },
): Promise<MintedDeveloperKey> {
  const orgId = input.developerOrgId
    ? (await requireMembership(db, input.developerOrgId, input.userId, 'admin')).org.id
    : await resolveOrgForUser(db, env, input.userId, input.displayName ?? '');

  const rawKey = generateApiKey('bfai');
  const keyHash = await hashSecret(rawKey);

  const [row] = await db
    .insert(developerApiKeys)
    .values({
      userId: input.userId,
      developerOrgId: orgId,
      name: input.name.trim() || 'My API Key',
      keyHash,
      scopes: serializeScopes(input.scopes, DEVELOPER_API_SCOPES),
    })
    .returning();

  if (!row) throw new DeveloperOrgError('failed to mint key', 409);
  return { ...toRow(row), key: rawKey };
}

/**
 * Every key a user can see: the ones their publishers hold.
 *
 * Listing by ORG rather than by minter is the point of the re-parenting — a
 * vendor's second engineer can now see and revoke the key the first one created,
 * which is what "the publisher owns the credential" has to mean in practice.
 */
export async function listDeveloperApiKeys(db: Db, userId: string): Promise<DeveloperApiKeyRow[]> {
  const memberships = await db
    .select({ orgId: developerOrgMembers.developerOrgId })
    .from(developerOrgMembers)
    .where(eq(developerOrgMembers.userId, userId));
  const orgIds = [...new Set(memberships.map((m) => m.orgId))];

  // A key is visible when the caller minted it OR when it belongs to a publisher
  // they are a member of. One statement with an `OR` rather than two queries
  // merged in memory — the minter clause is what keeps a LEGACY row (no org,
  // pre-0467) visible to the only person who can see it.
  const rows = await db
    .select()
    .from(developerApiKeys)
    .where(
      orgIds.length
        ? or(eq(developerApiKeys.userId, userId), inArray(developerApiKeys.developerOrgId, orgIds))
        : eq(developerApiKeys.userId, userId),
    )
    .orderBy(desc(developerApiKeys.createdAt));

  return rows.map(toRow);
}

/** Revoke a key. Any admin of the owning publisher may, not only its minter. */
export async function revokeDeveloperApiKey(db: Db, keyId: string, userId: string): Promise<void> {
  const [row] = await db.select().from(developerApiKeys).where(eq(developerApiKeys.id, keyId)).limit(1);
  if (!row) throw new DeveloperOrgError('key not found', 404);

  if (row.userId !== userId) {
    if (!row.developerOrgId) throw new DeveloperOrgError('forbidden', 403);
    await requireMembership(db, row.developerOrgId, userId, 'admin');
  }

  await db.update(developerApiKeys).set({ revokedAt: new Date() }).where(eq(developerApiKeys.id, keyId));
}

export interface ResolvedDeveloperKey {
  keyId: string;
  userId: string;
  developerOrgId: string | null;
  scopes: string[] | null;
}

/**
 * Resolve a raw `bfai_*` key, enforcing `required` if given.
 *
 * The ONE place `/api/v1` decides whether a caller is allowed in. Previously
 * every endpoint re-implemented "hash it, look it up, is it revoked" and none of
 * them asked about scopes, because there were none to ask about.
 */
export async function resolveDeveloperApiKey(
  db: Db,
  rawKey: string,
  required?: DeveloperApiScope,
): Promise<ResolvedDeveloperKey | null> {
  const keyHash = await hashSecret(rawKey);
  const [row] = await db
    .select({
      id: developerApiKeys.id,
      userId: developerApiKeys.userId,
      developerOrgId: developerApiKeys.developerOrgId,
      scopes: developerApiKeys.scopes,
    })
    .from(developerApiKeys)
    .where(and(eq(developerApiKeys.keyHash, keyHash), isNull(developerApiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;

  const scopes = deserializeScopes(row.scopes);
  if (required && !hasScope(scopes, required)) return null;

  return { keyId: row.id, userId: row.userId, developerOrgId: row.developerOrgId, scopes };
}
