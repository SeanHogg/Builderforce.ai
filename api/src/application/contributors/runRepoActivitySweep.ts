import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Repo activity sweep — the cron-driven producer that makes "connect a repo →
 * its activity is ingested" true with ZERO setup (no webhook required) and that
 * BACKFILLS history on first sync.
 *
 * For every connected GitHub repo with a stored credential whose sync interval has
 * elapsed, this resolves + decrypts the credential, pulls commits / PRs / reviews
 * since the repo's watermark (or a backfill window on first sync) via the GitHub
 * REST API, ingests them through the shared {@link ingestActivityEvents} core
 * (auto-creating contributors, attributing to the project), and advances the
 * watermark (`project_repositories.last_activity_synced_at`).
 *
 * Invoked from the Worker `scheduled()` frequent tick (mirrors runBoardSyncSweep).
 * Each repo is independent so one bad credential / unreachable host can't stall the
 * rest; bounded per tick so the sweep stays within the subrequest budget.
 */
import { and, inArray, sql } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projectRepositories } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { loadSweepStamps } from '../../infrastructure/cache/sweepStampLedger';
import { resolveRepoCredential, isResolveError } from '../repos/resolveRepoCredential';
import { makeRepoFetch } from '../repos/sources/RepoSource';
import { createActivitySource, POLLABLE_PROVIDERS } from './activitySourceFactory';
import { ingestActivityEvents, type ActivityProvider } from './activityIngest';

export interface RepoActivitySweepResult {
  due: number;
  synced: number;
  inserted: number;
  errors: number;
}

/** Re-poll a repo at most this often. */
const SYNC_INTERVAL_SEC = 15 * 60;
/** Max repos per tick — bounds the sweep's subrequest budget. */
const MAX_REPOS_PER_TICK = 25;
/** First-sync backfill window. */
const BACKFILL_DAYS = 90;
/** KV key of this sweep's "last checked" ledger (see sweepStampLedger). */
export const REPO_ACTIVITY_STAMPS_KEY = 'sweep:repo-activity:checked';

/** What one repo's poll saw: events fetched since the watermark, and how many were new rows. */
interface RepoActivityPoll { seen: number; inserted: number }

/**
 * Pull + ingest activity for one connected repo. Returns what it saw, or null when
 * the repo couldn't be synced (bad credential / non-github / API down). It does NOT
 * move the watermark: the sweep advances, in ONE statement, the watermark of every
 * repo that saw new activity (see {@link runRepoActivitySweep}).
 */
async function syncRepoActivity(
  db: Db, env: Env, secret: string, repo: typeof projectRepositories.$inferSelect, now: Date,
): Promise<RepoActivityPoll | null> {
  if (!repo.credentialId) return null;

  const resolved = await resolveRepoCredential(db, secret, repo.tenantId, repo.id);
  if (isResolveError(resolved)) return null;

  const source = createActivitySource(
    repo.provider,
    { owner: repo.owner, repo: repo.repo, host: repo.host, token: resolved.token },
    makeRepoFetch(),
  );
  if (!source) return null;   // provider not pollable

  const since = repo.lastActivitySyncedAt ?? new Date(now.getTime() - BACKFILL_DAYS * 24 * 3_600_000);
  const repoFullName = `${repo.owner}/${repo.repo}`;

  const events = await source.fetchSince(since, repoFullName, repo.repo);
  const { inserted } = events.length
    ? await ingestActivityEvents(env, db, { tenantId: repo.tenantId, provider: repo.provider as ActivityProvider, events })
    : { inserted: 0 };

  return { seen: events.length, inserted };
}

/**
 * Poll + ingest every due connected GitHub repo. Safe on every cron tick.
 *
 * WHEN A REPO IS DUE lives in KV (the sweep's stamp ledger), not in the watermark.
 * The watermark used to double as the rotation key, so it was rewritten every interval
 * for every synced repo even when GitHub returned nothing — a Postgres write per tick
 * that kept Neon awake. Now a quiet repo is stamped in KV and its row is untouched; the
 * watermark moves only when the poll actually SAW activity. A cold/unbound KV falls back
 * to the watermark, so the cadence degrades to the old one rather than to every tick.
 */
export async function runRepoActivitySweep(env: Env, db: Db = buildDatabase(env as unknown as Parameters<typeof buildDatabase>[0])): Promise<RepoActivitySweepResult> {
  const secret = integrationCredentialSecret(env);
  const now = new Date();

  // Candidates = pollable provider + has a credential. Read uncapped: which of them are
  // due is decided by the ledger (a quiet repo's watermark no longer advances, so a
  // capped watermark-ordered read would starve every repo past the cap).
  const candidates = await db
    .select()
    .from(projectRepositories)
    .where(acrossTenants(projectRepositories, 'scheduled_sweep', and(
      inArray(projectRepositories.provider, [...POLLABLE_PROVIDERS]),
      sql`${projectRepositories.credentialId} is not null`,
    )));
  const stamps = await loadSweepStamps(env, REPO_ACTIVITY_STAMPS_KEY);
  // Never-checked first, then oldest-checked first, so the per-tick cap rotates fairly.
  const due = stamps.due(candidates, {
    id: (r) => r.id,
    fallback: (r) => r.lastActivitySyncedAt,
    intervalMs: SYNC_INTERVAL_SEC * 1000,
    limit: MAX_REPOS_PER_TICK,
    now: now.getTime(),
  });

  let inserted = 0;
  let errors = 0;
  let synced = 0;
  const advancedIds: string[] = [];

  for (const repo of due) {
    // Stamped on attempt, success or failure: an unsyncable repo (bad credential, API
    // down) retries on the interval rather than every tick.
    stamps.stamp(repo.id, now.getTime());
    try {
      const poll = await syncRepoActivity(db, env, secret, repo, now);
      if (poll == null) { errors++; continue; }
      synced++;
      if (poll.seen > 0) advancedIds.push(repo.id);
      inserted += poll.inserted;
    } catch (e) {
      errors++;
      reportCaughtError(e, { source: "application/contributors/runRepoActivitySweep.ts", operation: "runRepoActivitySweep", context: { logMessage: `[cron:repo-activity] repo ${repo.id} (${repo.owner}/${repo.repo}) failed`, details: e } });
    }
  }

  // Advance the watermark ONLY of repos whose poll saw activity — ONE statement for all
  // of them, and no statement at all on a quiet tick. A quiet repo keeps its watermark
  // (re-asking GitHub from it returns nothing new); its cadence is the KV stamp below.
  if (advancedIds.length) {
    await db.update(projectRepositories)
      .set({ lastActivitySyncedAt: now })
      .where(acrossTenants(projectRepositories, 'scheduled_sweep', inArray(projectRepositories.id, advancedIds)));
  }
  await stamps.save();

  // NOT logged here: the cron runner owns the `[cron:<key>]` line and only emits it
  // when there was something to say (see cronSweeps.ts). This used to print on every
  // tick, 288 times a day, whether or not a repo was due.
  return { due: due.length, synced, inserted, errors };
}
