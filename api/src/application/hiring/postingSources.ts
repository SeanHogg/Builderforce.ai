/**
 * Where a posting's applications came from — the grouped read, and the attribution of
 * those sources to the job boards the posting went out on.
 *
 * Split from `postings.ts`, which is the canvas projection of a requisition (its counts,
 * its create/refresh path). This is one question with its own rules: a source is free text
 * on the way in and a controlled board key on the way out, and the fold between them is
 * `applicantSource.ts`. Both the posting projection and any other reader of
 * "which board is working" call these two functions.
 */

import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { jobApplications } from '../../infrastructure/database/schema/hiring';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { foldSourceCounts, withBoardSources } from './applicantSource';
import type { PostingDistributionView } from './postingDistributionStore';

/** One source-of-application line. `board` is present when the source IS a job board
 *  this posting was distributed to. */
export interface PostingSource {
  source: string;
  count: number;
  board?: string;
}

/**
 * Source-of-application, per posting.
 *
 * A second grouped read rather than a nested aggregate inside the first: that one is
 * already a four-way `filter` and adding a second grouping level to it produces a
 * statement nobody can read six months later. Both are indexed reads over the same two
 * tables and they run in parallel at every call site.
 */
export async function readPostingSources(
  db: Db,
  tenantId: number,
  postingId?: string,
): Promise<Map<string, Array<{ source: string; count: number }>>> {
  const rows = await db
    .select({
      postingId: jobApplications.jobPostingId,
      source: jobApplications.source,
      count: sql<number>`count(*)::int`,
    })
    .from(jobApplications)
    .where(scopedToTenant(
      jobApplications,
      tenantId,
      postingId
        ? eq(jobApplications.jobPostingId, postingId)
        : sql`${jobApplications.jobPostingId} is not null`,
    ))
    .groupBy(jobApplications.jobPostingId, jobApplications.source)
    .orderBy(desc(sql`count(*)`));

  const byPosting = new Map<string, Array<{ source: string; count: number }>>();
  for (const row of rows) {
    if (!row.postingId) continue;
    const list = byPosting.get(row.postingId) ?? [];
    list.push({ source: row.source, count: Number(row.count ?? 0) });
    byPosting.set(row.postingId, list);
  }
  return byPosting;
}

/**
 * Applicant volume, attributed to the boards a posting went out on.
 *
 * The join is the board's catalog key: an application recorded as coming from a board
 * carries that key in `job_applications.source`, and a distribution row is keyed on the
 * same value. A free-text source like "LinkedIn" is folded onto `linkedin-jobs` ONLY when
 * a board's manifest declares that spelling in `sourceAliases` — the built-in boards, plus
 * any other board the posting was distributed to (a tenant-authored one brings the aliases
 * its already-loaded manifest declared). `resolveApplicantSource` is case-, whitespace-
 * and URL-host-insensitive, and an alias two boards claim matches neither, because a
 * misattributed applicant is a wrong answer to "which board is working". A spelling no
 * manifest declares stays the plain source it is.
 *
 * Exported so the attribution is asserted directly.
 */
export function attributeSources(
  rawSources: ReadonlyArray<{ source: string; count: number }>,
  distributions: readonly PostingDistributionView[],
): PostingSource[] {
  const known = withBoardSources(distributions.map((row) => ({ key: row.connectorKey, aliases: row.sourceAliases })));
  const sources = foldSourceCounts(rawSources, known);
  const boards = new Map(distributions.map((row) => [row.connectorKey, row.board]));
  const out: PostingSource[] = sources.map((entry) => {
    const board = boards.get(entry.source);
    return board ? { ...entry, board } : { ...entry };
  });
  const counted = new Set(sources.map((entry) => entry.source));
  for (const row of distributions) {
    if (!counted.has(row.connectorKey)) out.push({ source: row.connectorKey, count: 0, board: row.board });
  }
  return out;
}
