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
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projectRepositories } from '../../infrastructure/database/schema';
import { resolveRepoCredential, isResolveError } from '../repos/resolveRepoCredential';
import { makeRepoFetch } from '../repos/sources/RepoSource';
import { GithubActivitySource } from './githubActivitySource';
import { ingestActivityEvents } from './activityIngest';

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
 * null when the repo couldn't be synced (bad credential / non-github / API down) —
 * the watermark is left unchanged so the next tick retries.
 */
export async function syncRepoActivity(
  db: Db, env: Env, secret: string, repo: typeof projectRepositories.$inferSelect, now: Date,
): Promise<number | null> {
  if (repo.provider !== 'github' || !repo.credentialId) return null;

  const resolved = await resolveRepoCredential(db, secret, repo.tenantId, repo.id);
  if (isResolveError(resolved)) return null;

  const since = repo.lastActivitySyncedAt ?? new Date(now.getTime() - BACKFILL_DAYS * 24 * 3_600_000);
  const repoFullName = `${repo.owner}/${repo.repo}`;
  const source = new GithubActivitySource(
    { owner: repo.owner, repo: repo.repo, host: repo.host, token: resolved.token },
    makeRepoFetch(),
  );

  const events = await source.fetchSince(since, repoFullName, repo.repo);
  const { inserted } = events.length
    ? await ingestActivityEvents(env, db, { tenantId: repo.tenantId, provider: 'github', events })
    : { inserted: 0 };

  // Advance the watermark even when nothing new — so we don't re-scan the window.
  await db.update(projectRepositories)
    .set({ lastActivitySyncedAt: now })
    .where(eq(projectRepositories.id, repo.id));

  return inserted;
}

/** Poll + ingest every due connected GitHub repo. Safe on every cron tick. */
export async function runRepoActivitySweep(env: Env): Promise<RepoActivitySweepResult> {
  const db = buildDatabase(env as unknown as Parameters<typeof buildDatabase>[0]);
  const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
  const now = new Date();
  const cutoff = new Date(now.getTime() - SYNC_INTERVAL_SEC * 1000);

  // Due = github + has a credential + (never synced OR interval elapsed). Oldest
  // watermark first so the sweep is fair across repos under the per-tick cap.
  const due = await db
    .select()
    .from(projectRepositories)
    .where(and(
      eq(projectRepositories.provider, 'github'),
      sql`${projectRepositories.credentialId} is not null`,
      or(isNull(projectRepositories.lastActivitySyncedAt), lt(projectRepositories.lastActivitySyncedAt, cutoff)),
    ))
    .orderBy(asc(sql`${projectRepositories.lastActivitySyncedAt} nulls first`))
    .limit(MAX_REPOS_PER_TICK);

  let synced = 0;
  let inserted = 0;
  let errors = 0;

  for (const repo of due) {
    try {
      const n = await syncRepoActivity(db, env, secret, repo, now);
      if (n == null) { errors++; continue; }
      synced++;
      inserted += n;
    } catch (e) {
      errors++;
      console.error(`[cron:repo-activity] repo ${repo.id} (${repo.owner}/${repo.repo}) failed`, e);
    }
  }

  console.log(`[cron:repo-activity] due=${due.length} synced=${synced} inserted=${inserted} errors=${errors}`);
  return { due: due.length, synced, inserted, errors };
}
