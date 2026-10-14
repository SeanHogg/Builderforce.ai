/**
 * Switch a hosted site's A/B split off (or on) NOW (PRD 33 §5.1.4).
 *
 * The sites Worker reads the running split under the tenant's sites version
 * (`siteAbSplit.runningSplitForSite`), so a test started or stopped anywhere — the
 * prescription actions, the verifier, or the general marketing route — must bump that
 * version or visitors keep being split for up to the cache TTL. This is the ONE helper
 * every start/stop path calls. Dependency-light (one indexed read + the version bump):
 * `experimentation.ts` sits in the sites Worker's import graph.
 */
import { eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { abTestVariants } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { bumpReplaySitesVersion } from './replayCacheKeys';

/** Bump the sites version of every Insights site this test's arms name. Never throws. */
export async function bumpSplitSitesForTest(env: Env | undefined, db: Db, tenantId: number, testId: number): Promise<number> {
  if (!env) return 0;
  try {
    const rows = await db
      .selectDistinct({ siteId: sql<string | null>`${abTestVariants.payload}->>'siteId'` })
      .from(abTestVariants)
      .where(scopedToTenant(abTestVariants, tenantId, eq(abTestVariants.testId, testId)));
    const sites = rows.map((r) => r.siteId).filter((id): id is string => typeof id === 'string' && id.length > 0);
    for (const siteId of sites) await bumpReplaySitesVersion(env, tenantId, siteId);
    return sites.length;
  } catch (error) {
    reportCaughtError(error, { source: 'application/replay/abSplitVersion.ts', operation: 'bumpSplitSitesForTest' });
    return 0;
  }
}
