/**
 * The `job_posting_distributions` reads and writes the SCHEDULED work needs: the worklist
 * the applicant import and the link-finding pass rotate through, the import's saved state,
 * and the resolved-link write.
 *
 * Split from `postingDistributionStore.ts`, which is what the card, the seat and the Brain
 * read (the publication list, its names and counts). Nothing here is shown to a person
 * except a resolved link; the rest is bookkeeping about when a board was last looked at,
 * and keeping it apart means a change to the sweep cannot disturb the card's reader.
 *
 * ROTATION IS `import_checked_at`, NOT `updated_at`. `updated_at` is what a person sees
 * ("updated 3 minutes ago"); a sweep that rewrote it on every pass would make every
 * publication look freshly edited. `import_checked_at` is only ever read by the sweep.
 *
 * A TOUCH IS ALSO A LEASE. {@link touchPostedDistribution} returns the value it wrote, and
 * {@link saveImportState} writes only while that value is still there: a manual press of
 * "Import" and the sweep can both be mid-import on one row, and whichever touched it last
 * owns the saved state — the other's write is dropped instead of clobbering it. (The
 * applications themselves are idempotent, so the dropped run's work is not lost.)
 */

import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { jobPostingDistributions, jobPostings } from '../../infrastructure/database/schema/hiring';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { MAX_TRACKED_FAILURES } from './importBudget';

type DistributionRow = typeof jobPostingDistributions.$inferSelect;

/** Failures counted per board application id; capped so the column stays small. */
export type ImportFailures = Record<string, number>;
export { MAX_TRACKED_FAILURES };

/** A confirmed publication, as the applicant import and link-finding need it. */
export interface PostedDistribution {
  tenantId: number;
  postingId: string;
  connectorKey: string;
  connectionId: string | null;
  externalId: string;
  /** The recorded public link; null is what the url-resolution pass looks for. */
  url: string | null;
  /** How far the applicant import has read this board. */
  importCursor: string | null;
  /** A newest-first walk that stopped at a cap resumes from this page. */
  importResumePage: number | null;
  /** …or, for a board that pages by token, from this token (1332). */
  importResumeToken?: string | null;
  /** The newest applicant seen so far in an unfinished newest-first walk. */
  importPendingCursor: string | null;
  /** Applicant ids whose own write has failed, with how many times. */
  importFailures: ImportFailures;
  /** The id the board's applicant list is filtered by, once resolved (1332). */
  boardFilterId?: string | null;
  /** What {@link touchPostedDistribution} wrote: the saved state is written only while it stands. */
  importLease?: string | null;
}

const toFailures = (value: unknown): ImportFailures => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, count]) => typeof count === 'number' && count > 0),
  ) as ImportFailures;
};

const toPosted = (row: DistributionRow): PostedDistribution[] => row.externalId
  ? [{
    tenantId: row.tenantId,
    postingId: row.jobPostingId,
    connectorKey: row.connectorKey,
    connectionId: row.connectionId ?? null,
    externalId: row.externalId,
    url: row.url ?? null,
    importCursor: row.importCursor ?? null,
    importResumePage: row.importResumePage ?? null,
    importResumeToken: row.importResumeToken ?? null,
    importPendingCursor: row.importPendingCursor ?? null,
    importFailures: toFailures(row.importFailures),
    boardFilterId: row.boardFilterId ?? null,
  }]
  : [];

const rowOf = (row: PostedDistribution) => scopedToTenant(
  jobPostingDistributions,
  row.tenantId,
  eq(jobPostingDistributions.jobPostingId, row.postingId),
  eq(jobPostingDistributions.connectorKey, row.connectorKey),
);

/** Confirmed publications of ONE posting in ONE workspace. */
export async function readPostedDistributions(db: Db, tenantId: number, postingId: string): Promise<PostedDistribution[]> {
  const rows = await db
    .select()
    .from(jobPostingDistributions)
    .where(scopedToTenant(
      jobPostingDistributions,
      tenantId,
      eq(jobPostingDistributions.jobPostingId, postingId),
      eq(jobPostingDistributions.status, 'posted'),
    ))
    .orderBy(asc(jobPostingDistributions.connectorKey));
  return rows.flatMap(toPosted);
}

/** A tenant-authored (or installed) board a posting is confirmed live on. */
export interface TenantBoard { tenantId: number; connectorKey: string }

/**
 * The next batch of confirmed publications on OPEN postings, across workspaces, least
 * recently CHECKED first — the scheduled work's worklist. DECLARED cross-tenant: the sweep
 * is a platform obligation, and each import it runs is then scoped to its own tenant (the
 * join is on tenant as well as posting, so a row can never pair with another tenant's
 * posting). `touchPostedDistribution` moves a row to the back of the queue so a bounded
 * batch rotates through every posting instead of re-reading the same ones; a row never
 * checked sorts first.
 */
export async function listPostedDistributionsForSweep(
  db: Db,
  limit: number,
  opts: {
    missingUrlOnly?: boolean;
    /** Only these boards: the importable ones for the import, the ones with a
     *  `resolve_url` action for link-finding — so a board that cannot do the work never
     *  spends the budget. */
    connectorKeys?: readonly string[];
    /** …plus these tenants' OWN boards (the keys are only meaningful inside one tenant). */
    tenantBoards?: readonly TenantBoard[];
  } = {},
): Promise<PostedDistribution[]> {
  const keys = opts.connectorKeys ?? [];
  const own = opts.tenantBoards ?? [];
  const filtered = opts.connectorKeys !== undefined || opts.tenantBoards !== undefined;
  if (filtered && keys.length === 0 && own.length === 0) return [];
  const boards = filtered
    ? or(
      keys.length ? inArray(jobPostingDistributions.connectorKey, [...keys]) : undefined,
      ...own.map((board) => and(
        eq(jobPostingDistributions.tenantId, board.tenantId),
        eq(jobPostingDistributions.connectorKey, board.connectorKey),
      )),
    )
    : undefined;
  const rows = await db
    .select({ distribution: jobPostingDistributions })
    .from(jobPostingDistributions)
    .innerJoin(jobPostings, sql`${jobPostings.id} = ${jobPostingDistributions.jobPostingId} and ${jobPostings.tenantId} = ${jobPostingDistributions.tenantId}`)
    .where(acrossTenants(
      jobPostingDistributions,
      'scheduled_sweep',
      eq(jobPostingDistributions.status, 'posted'),
      eq(jobPostings.status, 'open'),
      // A row whose last resolve found a conflict waits out `resolve_retry_at` (its own
      // schedule — NOT the import rotation key) instead of failing the same way every sweep.
      opts.missingUrlOnly ? isNull(jobPostingDistributions.url) : undefined,
      opts.missingUrlOnly
        ? or(isNull(jobPostingDistributions.resolveRetryAt), sql`${jobPostingDistributions.resolveRetryAt} <= now()`)
        : undefined,
      boards,
    ))
    .orderBy(sql`${jobPostingDistributions.importCheckedAt} asc nulls first`)
    .limit(limit);
  return rows.flatMap((row) => toPosted(row.distribution));
}

/**
 * The distinct (tenant, board key) pairs of confirmed publications on open postings whose
 * key is NOT one of `excludeKeys` (the built-ins) — i.e. boards a tenant authored or
 * installed, which the sweep can only judge importable by reading that tenant's catalog.
 */
export async function listTenantBoardKeys(db: Db, excludeKeys: readonly string[], limit: number): Promise<TenantBoard[]> {
  const rows = await db
    .selectDistinct({ tenantId: jobPostingDistributions.tenantId, connectorKey: jobPostingDistributions.connectorKey })
    .from(jobPostingDistributions)
    .innerJoin(jobPostings, sql`${jobPostings.id} = ${jobPostingDistributions.jobPostingId} and ${jobPostings.tenantId} = ${jobPostingDistributions.tenantId}`)
    .where(acrossTenants(
      jobPostingDistributions,
      'scheduled_sweep',
      eq(jobPostingDistributions.status, 'posted'),
      eq(jobPostings.status, 'open'),
      excludeKeys.length ? sql`${jobPostingDistributions.connectorKey} not in (${sql.join(excludeKeys.map((key) => sql`${key}`), sql`, `)})` : undefined,
    ))
    .limit(limit);
  return rows;
}

/**
 * Move a row to the back of the sweep's queue and return the value written — the lease
 * {@link saveImportState} checks. Never touches the user-visible `updated_at`.
 *
 * Written truncated to the millisecond and returned as TEXT: the lease is compared in SQL
 * as text, so neither the driver's Date handling nor the session time zone can make a
 * row's own value fail to match itself.
 */
export async function touchPostedDistribution(db: Db, row: PostedDistribution): Promise<string | null> {
  const [touched] = await db
    .update(jobPostingDistributions)
    .set({ importCheckedAt: sql`date_trunc('milliseconds', now())` })
    .where(rowOf(row))
    .returning({ lease: sql<string>`${jobPostingDistributions.importCheckedAt}::text` });
  return touched?.lease ?? null;
}

/** What the applicant import remembers about a board between runs. */
export interface ImportStateWrite {
  /** Omitted ⇒ the saved cursor is left where it is. */
  cursor?: string;
  resumePage: number | null;
  resumeToken?: string | null;
  pendingCursor: string | null;
  failures: ImportFailures;
}

/**
 * Save the import's state after a run (cursor, resume point, quarantine counts). Returns
 * false when the row's lease is no longer the one this run took — a later run owns the
 * state, and this write is dropped.
 */
export async function saveImportState(db: Db, row: PostedDistribution, state: ImportStateWrite): Promise<boolean> {
  const failures = Object.fromEntries(Object.entries(state.failures).slice(0, MAX_TRACKED_FAILURES));
  const saved = await db
    .update(jobPostingDistributions)
    .set({
      ...(state.cursor !== undefined ? { importCursor: state.cursor.slice(0, 64) } : {}),
      importResumePage: state.resumePage,
      // A token longer than the column is not stored: the walk starts over, which re-reads
      // (idempotent) rather than failing the whole state write.
      importResumeToken: state.resumeToken && state.resumeToken.length <= 512 ? state.resumeToken : null,
      importPendingCursor: state.pendingCursor ? state.pendingCursor.slice(0, 64) : null,
      importFailures: failures,
    })
    .where(and(
      rowOf(row),
      row.importLease ? sql`${jobPostingDistributions.importCheckedAt}::text = ${row.importLease}` : undefined,
    ))
    .returning({ id: jobPostingDistributions.id });
  return saved.length > 0;
}

/** Cache the id the board's applicant list is filtered by (see `applicants.filterIdFrom`). */
export async function saveBoardFilterId(db: Db, row: PostedDistribution, filterId: string): Promise<void> {
  await db
    .update(jobPostingDistributions)
    .set({ boardFilterId: filterId.slice(0, 255) })
    .where(rowOf(row));
}

/**
 * Record what url resolution found: the public link and, when the board gave one, its
 * REAL id (replacing a task/reference the create call returned). Only a CONFIRMED row is
 * touched, and only the fields that were found — a miss never erases what is there. A
 * link is a real change a person sees, so this one DOES move `updated_at`.
 *
 * A REPLACED id invalidates the cached `board_filter_id` (it was resolved from the old one).
 */
export async function recordResolvedLink(
  db: Db,
  row: PostedDistribution,
  found: { url: string | null; externalId: string | null },
): Promise<void> {
  // The id is replaced only TOGETHER with the link that proves it resolved.
  if (!found.url) return;
  const set: Record<string, unknown> = { updatedAt: sql`now()`, url: found.url };
  if (found.externalId) { set.externalId = found.externalId.slice(0, 255); set.boardFilterId = null; }
  await db
    .update(jobPostingDistributions)
    .set(set)
    .where(scopedToTenant(
      jobPostingDistributions,
      row.tenantId,
      eq(jobPostingDistributions.jobPostingId, row.postingId),
      eq(jobPostingDistributions.connectorKey, row.connectorKey),
      eq(jobPostingDistributions.status, 'posted'),
    ));
}

/** How long a row whose resolved id collided is left alone. */
const RESOLVE_CONFLICT_BACKOFF = '30 days';

/**
 * The board's resolved job id is already linked to another posting (1328's unique index
 * refused it). Say so on the row and back it off on ITS OWN schedule (`resolve_retry_at`),
 * rather than retrying every sweep — and without touching `import_checked_at`, which would
 * also freeze the row's applicant import for the same month.
 */
export async function markResolveConflict(db: Db, row: PostedDistribution, message: string): Promise<void> {
  await db
    .update(jobPostingDistributions)
    .set({
      lastError: message.slice(0, 600),
      resolveRetryAt: sql`now() + ${RESOLVE_CONFLICT_BACKOFF}::interval`,
    })
    .where(scopedToTenant(
      jobPostingDistributions,
      row.tenantId,
      eq(jobPostingDistributions.jobPostingId, row.postingId),
      eq(jobPostingDistributions.connectorKey, row.connectorKey),
      eq(jobPostingDistributions.status, 'posted'),
    ));
}
