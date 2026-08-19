/**
 * The half of a job alert that actually alerts.
 *
 * ── WHAT WAS MISSING ─────────────────────────────────────────────────────────────
 * `POST/PATCH/DELETE /api/jobs/alerts` persisted a `saved_searches` row with
 * `scope='listing'` and an `enabled` flag, and `JobAlertsPanel` managed them — but
 * nothing ever ran one. `last_run_at` and `result_count` were always null, which is the
 * tell: those two columns exist to record an evaluation that never happened. A
 * standing search that is stored and never evaluated is not a feature with a missing
 * half, it is a promise the product breaks quietly, every day, for every seeker who
 * set one up.
 *
 * The two primitives this needs already existed and were never joined: `notify()`
 * writes the durable in-app row (plus a best-effort email), and the KV work-gate lets
 * a scheduled sweep run without waking Neon on idle ticks. What was missing was the
 * evaluator between them, which is all this module is.
 *
 * ── THE WATERMARK IS `last_run_at`, AND THAT IS THE WHOLE ANTI-SPAM DESIGN ───────
 * An alert notifies about postings created SINCE it last ran, never about the whole
 * open board. Two consequences worth stating because both are deliberate:
 *
 *   • A newly created alert has `last_run_at = null`, and its watermark falls back to
 *     its own `created_at` — so it announces work posted after the seeker asked, not
 *     the back catalogue they were already looking at when they saved it.
 *   • The stamp is written even when nothing matched. An alert that matches nothing
 *     for a week must still advance, or the day it finally matches it would sweep up
 *     a week of postings at once.
 *
 * That makes the sweep idempotent in the way that matters: running it twice in one
 * day sends nothing the second time, because the first run moved the watermark past
 * everything it saw.
 *
 * ── ONE QUERY FOR THE WINDOW, NOT ONE PER ALERT ─────────────────────────────────
 * The obvious implementation issues a filtered query per saved search, which is the
 * N+1 the performance rule forbids and which scales with the number of SEEKERS rather
 * than with the amount of new work. Instead the sweep reads the postings window ONCE
 * — every open, public posting created since the OLDEST watermark in the batch — and
 * matches each alert against it in memory through `jobFilterMatches`, the same spec
 * the browse surface lowers to SQL. Two queries plus the notifications, whatever the
 * number of alerts.
 *
 * ── WHY IT IS CROSS-TENANT, DECLARED ────────────────────────────────────────────
 * A seeker's alerts live in their own personal workspace and the postings they match
 * belong to employers' workspaces, so the window read is cross-tenant by construction
 * — the same reason `POST /:id/save` is. It is declared through `acrossTenants` with
 * the public-catalogue reason rather than left to a missing filter, and the predicate
 * is exactly what the anonymous browse route already exposes: open and public.
 */
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import { resolveAppBaseUrl } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { jobPostings, savedSearches, tenants } from '../../infrastructure/database/schema';
import { notify } from '../notifications/notify';
import { describeJobFilters, jobFilterMatches, normalizeJobFilters } from './jobFilters';

/** The notification kind these rows carry, so the feed can group and the UI can route. */
export const JOB_ALERT_NOTIFICATION_KIND = 'job_alert';

/**
 * How many alerts one sweep evaluates.
 *
 * Bounded rather than unbounded because this is a cross-tenant scan and an unbounded
 * result set is the other half of the same performance rule. Ordered by `last_run_at`
 * with nulls first, so the alerts that have waited longest are always the ones served
 * — a ceiling that starves the same rows every day is worse than no ceiling.
 */
export const JOB_ALERT_SWEEP_LIMIT = 500;

/** How many postings one sweep will consider, newest window first. */
export const JOB_ALERT_POSTING_LIMIT = 500;

/**
 * The most matches one notification names.
 *
 * A seeker gets ONE row per alert per run, not one per posting: a broad alert on a
 * busy day would otherwise bury the feed it is supposed to surface. The count is
 * always exact; only the titles are trimmed.
 */
export const JOB_ALERT_TITLES_IN_BODY = 5;

/**
 * How far back a first run reaches when an alert somehow has neither a run stamp nor
 * a creation date. Belt and braces — `created_at` is `NOT NULL` — but the fallback
 * must be a bounded window rather than "the beginning of time", because the one thing
 * this sweep must never do is mail somebody the entire board.
 */
const FIRST_RUN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface JobAlertSweepResult {
  /** Alerts evaluated this run. */
  evaluated: number;
  /** Alerts that matched at least one new posting. */
  matched: number;
  /** Notifications written. */
  notified: number;
  /** Notifications that could not be written. */
  failed: number;
}

interface AlertRow {
  id: number;
  tenantId: number;
  ownerRef: string;
  name: string;
  filters: unknown;
  lastRunAt: Date | null;
  createdAt: Date;
}

interface PostingRow {
  id: string;
  title: string;
  description: string | null;
  discipline: string | null;
  skills: string | null;
  createdAt: Date;
  tenantName: string | null;
}

/** The instant an alert's window opens. */
function watermark(alert: AlertRow, now: Date): Date {
  const stamp = alert.lastRunAt ?? alert.createdAt;
  if (stamp instanceof Date && Number.isFinite(stamp.getTime())) return stamp;
  return new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
}

/** The alerts this run will evaluate: `scope='listing'`, not turned off. */
async function dueAlerts(db: Db): Promise<AlertRow[]> {
  const rows = await db
    .select({
      id: savedSearches.id,
      tenantId: savedSearches.tenantId,
      ownerRef: savedSearches.ownerRef,
      name: savedSearches.name,
      filters: savedSearches.filters,
      lastRunAt: savedSearches.lastRunAt,
      createdAt: savedSearches.createdAt,
    })
    .from(savedSearches)
    .where(acrossTenants(
      savedSearches,
      'scheduled_sweep',
      and(
        eq(savedSearches.scope, 'listing'),
        // `enabled` lives inside the filters blob (see `mapAlert`), so the "off" test
        // is done in SQL against the JSON rather than by loading every row and
        // discarding most of them. Absent means on, which is what the wire shape says.
        sql`COALESCE(${savedSearches.filters} ->> 'enabled', 'true') <> 'false'`,
      )!,
    ))
    // NULLS FIRST: an alert that has never run is the most overdue thing on the list.
    .orderBy(sql`${savedSearches.lastRunAt} ASC NULLS FIRST`, asc(savedSearches.id))
    .limit(JOB_ALERT_SWEEP_LIMIT);
  return rows as AlertRow[];
}

/** Every open, public posting created since `since` — the window every alert in this
 *  batch is matched against. */
async function postingWindow(db: Db, since: Date): Promise<PostingRow[]> {
  const rows = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      description: jobPostings.description,
      discipline: jobPostings.discipline,
      skills: jobPostings.skills,
      createdAt: jobPostings.createdAt,
      tenantName: tenants.name,
    })
    .from(jobPostings)
    .innerJoin(tenants, eq(tenants.id, jobPostings.tenantId))
    .where(acrossTenants(
      jobPostings,
      'public_catalogue',
      and(
        eq(jobPostings.status, 'open'),
        eq(jobPostings.visibility, 'public'),
        gt(jobPostings.createdAt, since),
      )!,
    ))
    .orderBy(asc(jobPostings.createdAt))
    .limit(JOB_ALERT_POSTING_LIMIT);
  return rows as PostingRow[];
}

/** The notification body: what matched, named, plus the count it was trimmed from. */
export function jobAlertBody(alert: { name: string; criteria: string }, matches: readonly { title: string; tenantName: string | null }[]): string {
  const named = matches.slice(0, JOB_ALERT_TITLES_IN_BODY)
    .map((m) => (m.tenantName ? `• ${m.title} — ${m.tenantName}` : `• ${m.title}`));
  const rest = matches.length - named.length;
  const lines = [
    alert.criteria ? `New work matching "${alert.name}" (${alert.criteria}):` : `New work matching "${alert.name}":`,
    ...named,
  ];
  if (rest > 0) lines.push(`…and ${rest} more.`);
  return lines.join('\n');
}

/**
 * Evaluate every enabled job alert and notify its owner about what is new.
 *
 * Best-effort per alert: one seeker's broken filter or failed notification must not
 * stop the sweep for everybody else, so each alert is stamped independently and a
 * failure is counted rather than thrown.
 */
export async function runJobAlertSweep(env: Env, db: Db, now = new Date()): Promise<JobAlertSweepResult> {
  const result: JobAlertSweepResult = { evaluated: 0, matched: 0, notified: 0, failed: 0 };

  const alerts = await dueAlerts(db);
  if (alerts.length === 0) return result;

  // ONE window for the whole batch, opened at the oldest watermark among the alerts
  // we are about to evaluate. Each alert then filters the window down to its own
  // window in memory — see the module header on why this is not a query per alert.
  const oldest = alerts.reduce<Date>((min, alert) => {
    const mark = watermark(alert, now);
    return mark < min ? mark : min;
  }, watermark(alerts[0]!, now));

  const window = await postingWindow(db, oldest);
  const baseUrl = resolveAppBaseUrl(env);
  const stampedNone: number[] = [];

  for (const alert of alerts) {
    result.evaluated += 1;
    const spec = normalizeJobFilters(alert.filters);
    const since = watermark(alert, now);
    const matches = window.filter((posting) =>
      posting.createdAt > since && jobFilterMatches(spec, posting));

    if (matches.length === 0) {
      // Still advance the watermark — see the header on why a quiet alert must move.
      stampedNone.push(alert.id);
      continue;
    }

    result.matched += 1;
    const criteria = describeJobFilters(spec);
    const delivered = await notify(db, env, {
      userId: alert.ownerRef,
      tenantId: alert.tenantId,
      kind: JOB_ALERT_NOTIFICATION_KIND,
      title: matches.length === 1
        ? `1 new job matches "${alert.name}"`
        : `${matches.length} new jobs match "${alert.name}"`,
      body: jobAlertBody({ name: alert.name, criteria }, matches),
      ref: `${baseUrl}/gigs`,
    });
    if (delivered.inAppDelivered) result.notified += 1;
    else result.failed += 1;

    await stamp(db, [alert.id], now, matches.length);
  }

  // The quiet alerts stamped in ONE statement rather than one per alert: they all get
  // the same run instant and the same zero count, so there is nothing per-row to say.
  if (stampedNone.length) await stamp(db, stampedNone, now, 0);

  return result;
}

/** Record that these alerts ran, and what they found. */
async function stamp(db: Db, ids: readonly number[], now: Date, resultCount: number): Promise<void> {
  if (!ids.length) return;
  await db.update(savedSearches)
    .set({ lastRunAt: now, resultCount, updatedAt: now })
    .where(inArray(savedSearches.id, [...ids]));
}
