/**
 * FO-B4 — the `job_posting_distributions` rows, read and written.
 *
 * The store half of distribution, kept apart from the use case
 * (`distributePosting.ts`) for the reason `postings.ts` keeps its reads apart from
 * the marketplace writer: the posting projection, the distribute route and the use
 * case all READ these rows, and only the use case WRITES them. One reader means the
 * card, the seat and the Brain tool see the same publication list — the card's
 * `distribution` field is drawn from {@link readPostingDistributions}, never kept.
 *
 * Uncached, like `listCanvasPostings`: "did it go out to Lever?" is asked right after
 * pressing Distribute, and a cached answer to that question is the wrong one.
 */

import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { jobApplications, jobPostingDistributions } from '../../infrastructure/database/schema/hiring';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { resolveConnector } from '../connectors/connectorRegistry';

/** The two states a row can be in. There is no `pending`: a publish is one call, and a
 *  row is written from its answer or not at all. */
export const DISTRIBUTION_STATUSES = ['posted', 'failed'] as const;
export type DistributionStatus = (typeof DISTRIBUTION_STATUSES)[number];

/** One publication, as every reader sees it. */
export interface PostingDistributionView {
  postingId: string;
  /** The board's catalog key — what `job_applications.source` carries for an
   *  application that board produced. */
  connectorKey: string;
  /** The board's display name, from its manifest. Falls back to the key for a
   *  connector the workspace has since removed, rather than dropping the row. */
  board: string;
  connectionId: string | null;
  externalId: string | null;
  url: string | null;
  status: DistributionStatus;
  postedAt: string | null;
  lastError: string | null;
  updatedAt: string;
  /** Applications against this posting whose `source` is this board's key — the
   *  board's share of the posting's applicant volume. Zero is a real answer. */
  applicantCount: number;
}

type DistributionRow = typeof jobPostingDistributions.$inferSelect;

const iso = (value: Date | string | null | undefined): string | null =>
  value == null ? null : new Date(value).toISOString();

/**
 * Display names for a set of board keys, each resolved ONCE.
 *
 * A built-in short-circuits in `resolveConnector` without a query, so the common
 * case — six built-in boards — costs nothing; only a tenant-authored or installed
 * board reads its manifest, through the same cached catalog every connector read uses.
 */
export async function boardNames(
  db: Db,
  tenantId: number,
  keys: Iterable<string>,
  env?: Env,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const key of new Set(keys)) {
    const resolved = await resolveConnector(db, tenantId, key, env);
    names.set(key, resolved?.manifest.name ?? key);
  }
  return names;
}

function toView(row: DistributionRow, names: ReadonlyMap<string, string>, applicants: number): PostingDistributionView {
  return {
    postingId: row.jobPostingId,
    connectorKey: row.connectorKey,
    board: names.get(row.connectorKey) ?? row.connectorKey,
    connectionId: row.connectionId ?? null,
    externalId: row.externalId ?? null,
    url: row.url ?? null,
    status: row.status === 'posted' ? 'posted' : 'failed',
    postedAt: iso(row.postedAt),
    lastError: row.lastError ?? null,
    updatedAt: iso(row.updatedAt) ?? new Date(0).toISOString(),
    applicantCount: applicants,
  };
}

const countKey = (postingId: string, source: string): string => `${postingId}|${source}`;

/**
 * Applications per (posting, board key), for the boards that HAVE distribution rows.
 *
 * An exact match on the controlled key, never a fuzzy one — see `attributeSources` in
 * `postings.ts`. One grouped read, issued only when there is something to count.
 */
async function applicantCountsByBoard(
  db: Db,
  tenantId: number,
  rows: readonly DistributionRow[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!rows.length) return counts;
  const postingIds = [...new Set(rows.map((row) => row.jobPostingId))];
  const keys = [...new Set(rows.map((row) => row.connectorKey))];
  const grouped = await db
    .select({
      postingId: jobApplications.jobPostingId,
      source: jobApplications.source,
      count: sql<number>`count(*)::int`,
    })
    .from(jobApplications)
    .where(scopedToTenant(
      jobApplications,
      tenantId,
      and(
        isNotNull(jobApplications.jobPostingId),
        inArray(jobApplications.jobPostingId, postingIds),
        inArray(jobApplications.source, keys),
      ),
    ))
    .groupBy(jobApplications.jobPostingId, jobApplications.source);
  for (const entry of grouped) {
    if (entry.postingId) counts.set(countKey(entry.postingId, entry.source), Number(entry.count ?? 0));
  }
  return counts;
}

/**
 * Every publication for one posting — or, with no id, for every posting the
 * workspace has — grouped by posting id. Ordered by board key so a card's rows do not
 * shuffle between refreshes.
 */
export async function readPostingDistributions(
  db: Db,
  tenantId: number,
  postingId?: string,
  env?: Env,
): Promise<Map<string, PostingDistributionView[]>> {
  const rows = await db
    .select()
    .from(jobPostingDistributions)
    .where(scopedToTenant(
      jobPostingDistributions,
      tenantId,
      postingId ? eq(jobPostingDistributions.jobPostingId, postingId) : undefined,
    ))
    .orderBy(asc(jobPostingDistributions.jobPostingId), asc(jobPostingDistributions.connectorKey));

  const [names, counts] = await Promise.all([
    boardNames(db, tenantId, rows.map((row) => row.connectorKey), env),
    applicantCountsByBoard(db, tenantId, rows),
  ]);
  const byPosting = new Map<string, PostingDistributionView[]>();
  for (const row of rows) {
    const list = byPosting.get(row.jobPostingId) ?? [];
    list.push(toView(row, names, counts.get(countKey(row.jobPostingId, row.connectorKey)) ?? 0));
    byPosting.set(row.jobPostingId, list);
  }
  return byPosting;
}

/** What one publish attempt established — the use case's verdict, written whole. */
export interface DistributionWrite {
  tenantId: number;
  postingId: string;
  connectorKey: string;
  connectionId: string | null;
  status: DistributionStatus;
  externalId: string | null;
  url: string | null;
  lastError: string | null;
}

/**
 * Record one attempt, keyed on (tenant, posting, board).
 *
 * A FAILED retry over an earlier failure replaces it. A failed attempt never reaches
 * a `posted` row in the first place — the use case skips boards that already confirmed
 * the posting — and the `ON CONFLICT … WHERE` below makes that a property of the write
 * as well: a failure cannot downgrade a confirmed publication, because the board still
 * holds the posting and forgetting its id is how the next press duplicates it.
 */
export async function recordPostingDistribution(db: Db, write: DistributionWrite): Promise<void> {
  const posted = write.status === 'posted';
  const values = {
    tenantId: write.tenantId,
    jobPostingId: write.postingId,
    connectorKey: write.connectorKey,
    connectionId: write.connectionId,
    status: write.status,
    externalId: posted ? write.externalId : null,
    url: posted ? write.url : null,
    postedAt: posted ? new Date() : null,
    lastError: posted ? null : write.lastError,
  };
  await db
    .insert(jobPostingDistributions)
    .values(values)
    .onConflictDoUpdate({
      target: [jobPostingDistributions.tenantId, jobPostingDistributions.jobPostingId, jobPostingDistributions.connectorKey],
      set: {
        connectionId: values.connectionId,
        status: values.status,
        externalId: values.externalId,
        url: values.url,
        postedAt: values.postedAt,
        lastError: values.lastError,
        updatedAt: sql`now()`,
      },
      // Only an unconfirmed row may be overwritten by a failure. See the docstring.
      ...(posted ? {} : { setWhere: ne(jobPostingDistributions.status, 'posted') }),
    });
}
