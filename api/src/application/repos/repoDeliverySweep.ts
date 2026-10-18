import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * The repo-delivery sweep — probes every due connected repo and persists its verdict
 * (the per-provider readers and the store live in `repoDelivery.ts`).
 *
 * ── IDLE-SILENT ─────────────────────────────────────────────────────────────
 * Only a CHANGED verdict touches Postgres. "When was this repo last probed" — the
 * rotation key that makes a repo due again — used to be `repo_delivery_status.probed_at`,
 * stamped by a narrow UPDATE on every unchanged probe: one write per repo every 30
 * minutes for a verdict that had not moved, which kept the Neon compute awake. It now
 * lives in the sweep's KV stamp ledger (`REPO_DELIVERY_STAMPS_KEY`). The column is still
 * written with every real verdict change (by `storeRepoDelivery`), and both the due
 * decision here and the dashboard read (`loadRepoDelivery`) take the NEWER of the KV
 * stamp and the column — so a cold KV degrades to the old cadence, never to silence.
 *
 * Ordering is never-probed first, then oldest-probed first, so a tenant with more repos
 * than one tick can cover gets all of them refreshed over successive ticks instead of
 * the same prefix forever.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { projectRepositories, repoDeliveryStatus } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { loadSweepStamps } from '../../infrastructure/cache/sweepStampLedger';
import {
  PROBEABLE_PROVIDERS,
  REPO_DELIVERY_STAMPS_KEY,
  probeRepoDelivery,
  storeRepoDelivery,
  type RepoDeliveryProbe,
} from './repoDelivery';
import type { Env } from '../../env';

export interface RepoDeliverySweepResult {
  due: number;
  probed: number;
  errors: number;
}

/** Max repos probed per tick — bounds the sweep's subrequest budget. A repo past the
 *  cap is not degraded: it is simply next in the rotation. */
const MAX_REPOS_PER_TICK = 25;
/**
 * Re-probe a repo at most this often.
 *
 * It was 5 minutes — exactly the cron cadence — so every connected repo was due on
 * every tick: two provider calls plus an upsert per repo, 288 times a day, for a
 * verdict (open-PR count, latest CI run) that a dashboard only needs to be roughly
 * current. Attaching a repo still shows a verdict at once via `refreshRepoDelivery`.
 */
export const REPO_DELIVERY_PROBE_INTERVAL_MS = 30 * 60_000;

/** The persisted verdict columns, as the due query reads them back for comparison. */
interface StoredVerdictColumns {
  health: string | null;
  reason: string | null;
  openPullRequests: number | null;
  buildStatus: string | null;
  buildUrl: string | null;
  buildBranch: string | null;
  buildAt: Date | string | null;
}

/**
 * Does a fresh probe say anything the stored row does not? `null` previous = no row
 * yet (the left join found nothing), which is always a change.
 */
export function repoDeliveryVerdictChanged(prev: StoredVerdictColumns | null, next: RepoDeliveryProbe): boolean {
  if (!prev || prev.health === null) return true;
  const prevBuildAt = prev.buildAt ? new Date(prev.buildAt).getTime() : null;
  const nextBuildAt = next.buildAt ? new Date(next.buildAt).getTime() : null;
  return prev.health !== next.health
    || (prev.reason ?? null) !== next.reason
    || (prev.openPullRequests ?? null) !== next.openPullRequests
    || (prev.buildStatus ?? null) !== next.buildStatus
    || (prev.buildUrl ?? null) !== next.buildUrl
    || (prev.buildBranch ?? null) !== next.buildBranch
    || prevBuildAt !== nextBuildAt;
}

/** Probe every due connected repo and persist its verdict. Safe on every tick. */
export async function runRepoDeliverySweep(
  env: Env,
  db: Db = buildDatabase(env as unknown as Parameters<typeof buildDatabase>[0]),
): Promise<RepoDeliverySweepResult> {
  const secret = integrationCredentialSecret(env);
  const now = Date.now();

  // Every probeable repo with a credential, read uncapped: which are due is the
  // ledger's call (the column no longer advances on an unchanged probe, so a capped
  // column-ordered read would starve every repo past the cap).
  const candidates = await db
    .select({
      id: projectRepositories.id,
      tenantId: projectRepositories.tenantId,
      owner: projectRepositories.owner,
      repo: projectRepositories.repo,
      probedAt: repoDeliveryStatus.probedAt,
      // The stored verdict, so an unchanged probe can skip the upsert.
      health: repoDeliveryStatus.health,
      reason: repoDeliveryStatus.reason,
      openPullRequests: repoDeliveryStatus.openPullRequests,
      buildStatus: repoDeliveryStatus.buildStatus,
      buildUrl: repoDeliveryStatus.buildUrl,
      buildBranch: repoDeliveryStatus.buildBranch,
      buildAt: repoDeliveryStatus.buildAt,
    })
    .from(projectRepositories)
    .leftJoin(repoDeliveryStatus, eq(repoDeliveryStatus.repoId, projectRepositories.id))
    .where(acrossTenants(projectRepositories, 'scheduled_sweep', and(
      inArray(projectRepositories.provider, [...PROBEABLE_PROVIDERS]),
      sql`${projectRepositories.credentialId} is not null`,
    )));

  const stamps = await loadSweepStamps(env, REPO_DELIVERY_STAMPS_KEY);
  const due = stamps.due(candidates, {
    id: (r) => r.id,
    fallback: (r) => r.probedAt,
    intervalMs: REPO_DELIVERY_PROBE_INTERVAL_MS,
    limit: MAX_REPOS_PER_TICK,
    now,
  });

  let probed = 0;
  let errors = 0;
  for (const repo of due) {
    try {
      const verdict = await probeRepoDelivery(env, db, secret, repo.tenantId, repo.id);
      // The column write rides ONLY a real verdict change; an unchanged probe is a
      // KV stamp and nothing else.
      if (repoDeliveryVerdictChanged(repo, verdict)) await storeRepoDelivery(db, repo.tenantId, repo.id, verdict);
      stamps.stamp(repo.id);
      probed++;
    } catch (e) {
      errors++;
      reportCaughtError(e, {
        source: 'application/repos/repoDeliverySweep.ts',
        operation: 'runRepoDeliverySweep',
        context: { logMessage: `[cron:repo-delivery] repo ${repo.id} (${repo.owner}/${repo.repo}) failed`, details: e },
      });
    }
  }
  await stamps.save();
  return { due: due.length, probed, errors };
}
