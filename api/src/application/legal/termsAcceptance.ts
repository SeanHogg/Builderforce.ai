import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Terms-of-service acceptance — the ONE place that answers "must this user accept
 * new terms before we serve them?".
 *
 * Three middlewares run this on EVERY authenticated request (`authMiddleware`,
 * `webAuthMiddleware`, `superAdminMiddleware`), so it sits squarely on the hot
 * path. Both inputs are slow-changing:
 *
 *   - the ACTIVE terms version changes only when an admin publishes/amends the
 *     document (a handful of times per year), and is the same for everyone;
 *   - a user's ACCEPTED version changes exactly once per acceptance.
 *
 * Recomputing both from Postgres per request was two neon-http round-trips on
 * every call, so each is served through the canonical read-through cache and
 * invalidated by its writer ({@link invalidateActiveTermsVersion} from the legal
 * publish/amend paths, {@link invalidateAcceptedTermsVersion} from the accept
 * path). A cache miss costs exactly what the old code cost every time.
 *
 * Lives in `application/` (not `presentation/middleware/`, where it used to) so
 * that application callers — `demoSeedService`, `legalDocsService` — no longer
 * import upward into the presentation layer.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { legalDocuments, userLegalAcceptances } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';

/** Cache key for the platform-wide active terms version. */
// Bump the key with each migration-published legal release. SQL migrations cannot
// invalidate Cloudflare KV, so changing the namespace prevents a deploy from
// serving the cached 1.0.0 version for up to an hour after 2.0.0 is published.
const ACTIVE_TERMS_KEY = 'terms:active-version:v2';

/** Cache key for one user's accepted terms version. */
const acceptedTermsKey = (userId: string): string => `terms:accepted:${userId}`;

/**
 * The active terms version is read by every request but written a few times a
 * year, so it is worth a long TTL; the publish/amend paths invalidate explicitly.
 */
const ACTIVE_TTL_SECONDS = 3_600;
const ACCEPTED_TTL_SECONDS = 3_600;

/** Wrapper so a `null` (no active terms doc) survives the cache, which treats a
 *  bare null as a miss and would re-query on every request. */
type VersionBox = { version: string | null };

async function loadActiveTermsVersion(db: Db): Promise<string | null> {
  const [doc] = await db
    .select({ version: legalDocuments.version })
    .from(legalDocuments)
    .where(
      and(
        eq(legalDocuments.documentType, 'terms'),
        eq(legalDocuments.isActive, true),
      ),
    )
    .orderBy(desc(legalDocuments.publishedAt))
    .limit(1);

  return doc?.version ?? null;
}

async function loadAcceptedTermsVersion(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ version: userLegalAcceptances.version })
    .from(userLegalAcceptances)
    .where(
      and(
        eq(userLegalAcceptances.userId, userId),
        eq(userLegalAcceptances.documentType, 'terms'),
      ),
    )
    .limit(1);

  return row?.version ?? null;
}

/**
 * The currently-published terms version, or null when the platform has none.
 * Pass `env` to serve from cache; omit it (tests, one-off scripts) to always read
 * through to the database.
 */
export async function getActiveTermsVersion(db: Db, env?: Env): Promise<string | null> {
  if (!env) return loadActiveTermsVersion(db);
  const box = await getOrSetCached<VersionBox>(
    env,
    ACTIVE_TERMS_KEY,
    async () => ({ version: await loadActiveTermsVersion(db) }),
    { kvTtlSeconds: ACTIVE_TTL_SECONDS },
  );
  return box.version;
}

/** The terms version this user has accepted, or null. */
export async function getAcceptedTermsVersion(db: Db, userId: string, env?: Env): Promise<string | null> {
  if (!env) return loadAcceptedTermsVersion(db, userId);
  const box = await getOrSetCached<VersionBox>(
    env,
    acceptedTermsKey(userId),
    async () => ({ version: await loadAcceptedTermsVersion(db, userId) }),
    { kvTtlSeconds: ACCEPTED_TTL_SECONDS },
  );
  return box.version;
}

export interface TermsAcceptanceStatus {
  requiredVersion: string | null;
  acceptedVersion: string | null;
  needsAcceptance: boolean;
}

/**
 * Does `userId` need to accept the current terms? Both lookups are cached when
 * `env` is supplied, and the accepted-version read is skipped entirely when the
 * platform has no active terms document.
 */
export async function checkTermsAcceptance(
  db: Db,
  userId: string,
  env?: Env,
): Promise<TermsAcceptanceStatus> {
  const requiredVersion = await getActiveTermsVersion(db, env);
  if (!requiredVersion) {
    return { requiredVersion: null, acceptedVersion: null, needsAcceptance: false };
  }

  const acceptedVersion = await getAcceptedTermsVersion(db, userId, env);
  return { requiredVersion, acceptedVersion, needsAcceptance: acceptedVersion !== requiredVersion };
}

/** Call after publishing or amending a legal document. Best-effort. */
export async function invalidateActiveTermsVersion(env: Env | undefined): Promise<void> {
  if (!env) return;
  await invalidateCached(env, ACTIVE_TERMS_KEY).catch((error) => {
    reportCaughtError(error, { source: "application/legal/termsAcceptance.ts", operation: "invalidateActiveTermsVersion" });
  });
}

/** Call after a user accepts terms. Best-effort. */
export async function invalidateAcceptedTermsVersion(env: Env | undefined, userId: string): Promise<void> {
  if (!env) return;
  await invalidateCached(env, acceptedTermsKey(userId)).catch((error) => {
    reportCaughtError(error, { source: "application/legal/termsAcceptance.ts", operation: "invalidateAcceptedTermsVersion" });
  });
}
