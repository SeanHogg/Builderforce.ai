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
import { and, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projectRepositories } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
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

/**
 * Pull + ingest activity for one connected repo. Returns the inserted count, or
 * null when the repo couldn't be synced (bad credential / non-github / API down).
 * It does NOT move the watermark: the sweep advances every synced repo's watermark
 * in ONE statement (see {@link runRepoActivitySweep}), and a repo that returned null
 * is left out of it so the next tick retries.
 */
async function syncRepoActivity(
  db: Db, env: Env, secret: string, repo: typeof projectRepositories.$inferSelect, now: Date,
): Promise<number | null> {
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

  return inserted;
}

/** Poll + ingest every due connected GitHub repo. Safe on every cron tick. */
export async function runRepoActivitySweep(env: Env): Promise<RepoActivitySweepResult> {
  const db = buildDatabase(env as unknown as Parameters<typeof buildDatabase>[0]);
  const secret = integrationCredentialSecret(env);
  const now = new Date();
  const cutoff = new Date(now.getTime() - SYNC_INTERVAL_SEC * 1000);

  // Due = pollable provider + has a credential + (never synced OR interval
  // elapsed). Oldest watermark first so the sweep is fair under the per-tick cap.
  const due = await db
    .select()
    .from(projectRepositories)
    .where(and(inArray(projectRepositories.provider, [...POLLABLE_PROVIDERS]), sql`${projectRepositories.credentialId} is not null`, or(isNull(projectRepositories.lastActivitySyncedAt), lt(projectRepositories.lastActivitySyncedAt, cutoff))))
    // ORDER BY direction and null placement must be ONE sql fragment in the right
    // order (`asc nulls first`). Wrapping the fragment in drizzle's `asc()` appends
    // the direction AFTER the null clause — `... nulls first asc` — which Postgres
    // rejects with `syntax error at or near "asc"`, so this sweep threw on its
    // FIRST query on every tick and never ingested an activity event. Matches the
    // idiom every other null-ordered query here uses (see ManagerService, TaskRepository).
    .orderBy(sql`${projectRepositories.lastActivitySyncedAt} asc nulls first`)
    .limit(MAX_REPOS_PER_TICK);

  let inserted = 0;
  let errors = 0;
  const syncedIds: string[] = [];

  for (const repo of due) {
    try {
      const n = await syncRepoActivity(db, env, secret, repo, now);
      if (n == null) { errors++; continue; }
      syncedIds.push(repo.id);
      inserted += n;
    } catch (e) {
      errors++;
      reportCaughtError(e, { source: "application/contributors/runRepoActivitySweep.ts", operation: "runRepoActivitySweep", context: { logMessage: `[cron:repo-activity] repo ${repo.id} (${repo.owner}/${repo.repo}) failed`, details: e } });
    }
  }

  // Advance the watermark of every repo that synced, even when nothing was new, so the
  // window is not re-scanned. The watermark is also what makes a repo due again, so it
  // is written every interval for every synced repo; ONE statement per tick keeps that
  // at one round trip instead of one per repo (up to MAX_REPOS_PER_TICK).
  if (syncedIds.length) {
    await db.update(projectRepositories)
      .set({ lastActivitySyncedAt: now })
      .where(acrossTenants(projectRepositories, 'scheduled_sweep', inArray(projectRepositories.id, syncedIds)));
  }

  // NOT logged here: the cron runner owns the `[cron:<key>]` line and only emits it
  // when there was something to say (see cronSweeps.ts). This used to print on every
  // tick, 288 times a day, whether or not a repo was due.
  return { due: due.length, synced: syncedIds.length, inserted, errors };
}
