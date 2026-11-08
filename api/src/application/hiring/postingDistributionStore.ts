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

import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { jobApplications, jobPostingDistributions, jobPostings } from '../../infrastructure/database/schema/hiring';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { resolveConnector } from '../connectors/connectorRegistry';
import { manifestYieldsPublicLink } from '../connectors/connectorResponseMapping';
import { resolveApplicantSource, withBoardSources, type BoardSourceCatalog } from './applicantSource';
import { PUBLISH_POSTING_ACTION } from './postingActionKeys';

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
  /** False when the board's manifest can never yield a per-job public link (Indeed) —
   *  the card then says so instead of showing a row that merely lacks one. */
  publicLinkSupported: boolean;
  /** The board manifest's `sourceAliases` — how readers fold free-text sources onto
   *  `connectorKey` without reloading the manifest (see `withBoardSources`). */
  sourceAliases: readonly string[];
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
  const infos = await boardInfos(db, tenantId, keys, env);
  return new Map([...infos].map(([key, info]) => [key, info.name]));
}

/** What a reader needs of a board's manifest: its name, and whether it can ever give a
 *  posting a public link by any route its manifest declares (see
 *  `manifestYieldsPublicLink`). */
export interface BoardInfo { name: string; linkable: boolean; aliases: readonly string[] }

export async function boardInfos(
  db: Db,
  tenantId: number,
  keys: Iterable<string>,
  env?: Env,
): Promise<Map<string, BoardInfo>> {
  const infos = new Map<string, BoardInfo>();
  for (const key of new Set(keys)) {
    const resolved = await resolveConnector(db, tenantId, key, env);
    infos.set(key, {
      name: resolved?.manifest.name ?? key,
      linkable: resolved ? manifestYieldsPublicLink(resolved.manifest, PUBLISH_POSTING_ACTION) : true,
      aliases: resolved?.manifest.sourceAliases ?? [],
    });
  }
  return infos;
}

function toView(row: DistributionRow, infos: ReadonlyMap<string, BoardInfo>, applicants: number): PostingDistributionView {
  const info = infos.get(row.connectorKey);
  return {
    postingId: row.jobPostingId,
    connectorKey: row.connectorKey,
    board: info?.name ?? row.connectorKey,
    publicLinkSupported: info?.linkable ?? true,
    sourceAliases: info?.aliases ?? [],
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
  known: BoardSourceCatalog,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!rows.length) return counts;
  const postingIds = [...new Set(rows.map((row) => row.jobPostingId))];
  // Grouped by raw source over the postings' applications (indexed by tenant + posting),
  // then folded onto board keys: rows written since normalisation carry the key itself,
  // older free-text spellings ("LinkedIn") fold in via the manifests' `sourceAliases`.
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
      ),
    ))
    .groupBy(jobApplications.jobPostingId, jobApplications.source);
  for (const entry of grouped) {
    if (!entry.postingId) continue;
    const key = countKey(entry.postingId, resolveApplicantSource(entry.source, known));
    counts.set(key, (counts.get(key) ?? 0) + Number(entry.count ?? 0));
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

  // Infos first: the counts fold spellings through the aliases of the very manifests
  // (built-in or tenant-authored) these rows name.
  const names = await boardInfos(db, tenantId, rows.map((row) => row.connectorKey), env);
  const counts = await applicantCountsByBoard(db, tenantId, rows, withBoardSources(
    [...names].map(([key, info]) => ({ key, aliases: info.aliases })),
  ));
  const byPosting = new Map<string, PostingDistributionView[]>();
  for (const row of rows) {
    const list = byPosting.get(row.jobPostingId) ?? [];
    list.push(toView(row, names, counts.get(countKey(row.jobPostingId, row.connectorKey)) ?? 0));
    byPosting.set(row.jobPostingId, list);
  }
  return byPosting;
}

/**
 * The boards an application to this posting can be attributed to: the built-ins plus the
 * boards the posting was distributed to, with the aliases THEIR manifests declare (so a
 * tenant-authored board folds too). One small keyed read; the manifests come through the
 * same {@link boardInfos} the posting views use.
 */
export async function readPostingBoardCatalog(
  db: Db,
  tenantId: number,
  postingId: string,
  env?: Env,
): Promise<BoardSourceCatalog> {
  const rows = await db
    .select({ connectorKey: jobPostingDistributions.connectorKey })
    .from(jobPostingDistributions)
    .where(scopedToTenant(jobPostingDistributions, tenantId, eq(jobPostingDistributions.jobPostingId, postingId)));
  const infos = await boardInfos(db, tenantId, rows.map((row) => row.connectorKey), env);
  return withBoardSources([...infos].map(([key, info]) => ({ key, aliases: info.aliases })));
}

/** A confirmed publication, as the applicant import needs it. */
export interface PostedDistribution {
  tenantId: number;
  postingId: string;
  connectorKey: string;
  connectionId: string | null;
  externalId: string;
  /** The recorded public link; null is what the url-resolution pass looks for. */
  url: string | null;
  /** How far the applicant import has read this board (see `importCursor`). */
  importCursor: string | null;
}

/**
 * Confirmed publications of ONE posting in ONE workspace.
 */
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

const toPosted = (row: DistributionRow): PostedDistribution[] => row.externalId
  ? [{ tenantId: row.tenantId, postingId: row.jobPostingId, connectorKey: row.connectorKey, connectionId: row.connectionId ?? null, externalId: row.externalId, url: row.url ?? null, importCursor: row.importCursor ?? null }]
  : [];

/**
 * The next batch of confirmed publications on OPEN postings, across workspaces, least
 * recently touched first — the scheduled applicant import's worklist. DECLARED
 * cross-tenant: the sweep is a platform obligation, and each import it runs is then
 * scoped to its own tenant. `touchPostedDistribution` moves a row to the back of the
 * queue so a bounded batch rotates through every posting instead of re-reading the same.
 */
export async function listPostedDistributionsForSweep(
  db: Db,
  limit: number,
  opts: {
    missingUrlOnly?: boolean;
    /** Only these boards. The link-finding pass passes the boards that HAVE a
     *  `resolve_url` action, so boards that cannot resolve never spend its budget. */
    connectorKeys?: readonly string[];
  } = {},
): Promise<PostedDistribution[]> {
  if (opts.connectorKeys && opts.connectorKeys.length === 0) return [];
  const rows = await db
    .select({ distribution: jobPostingDistributions })
    .from(jobPostingDistributions)
    .innerJoin(jobPostings, eq(jobPostings.id, jobPostingDistributions.jobPostingId))
    .where(acrossTenants(
      jobPostingDistributions,
      'scheduled_sweep',
      eq(jobPostingDistributions.status, 'posted'),
      eq(jobPostings.status, 'open'),
      opts.missingUrlOnly ? isNull(jobPostingDistributions.url) : undefined,
      opts.connectorKeys ? inArray(jobPostingDistributions.connectorKey, [...opts.connectorKeys]) : undefined,
    ))
    .orderBy(asc(jobPostingDistributions.updatedAt))
    .limit(limit);
  return rows.flatMap((row) => toPosted(row.distribution));
}

/** The posting (if any) that already holds this board job as a confirmed publication. */
export async function findPostingLinkedToBoardJob(
  db: Db,
  tenantId: number,
  connectorKey: string,
  externalId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ postingId: jobPostingDistributions.jobPostingId })
    .from(jobPostingDistributions)
    .where(scopedToTenant(
      jobPostingDistributions,
      tenantId,
      eq(jobPostingDistributions.connectorKey, connectorKey),
      eq(jobPostingDistributions.externalId, externalId),
      eq(jobPostingDistributions.status, 'posted'),
    ))
    .limit(1);
  return row?.postingId ?? null;
}

/**
 * Record what url resolution found: the public link and, when the board gave one, its
 * REAL id (replacing a task/reference the create call returned). Only a CONFIRMED row is
 * touched, and only the fields that were found — a miss never erases what is there.
 */
export async function recordResolvedLink(
  db: Db,
  row: PostedDistribution,
  found: { url: string | null; externalId: string | null },
): Promise<void> {
  // The id is replaced only TOGETHER with the link that proves it resolved.
  if (!found.url) return;
  const set: Record<string, unknown> = { updatedAt: sql`now()`, url: found.url };
  if (found.externalId) set.externalId = found.externalId.slice(0, 255);
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

/** Remember how far the applicant import has read this board. */
export async function saveImportCursor(db: Db, row: PostedDistribution, cursor: string): Promise<void> {
  await db
    .update(jobPostingDistributions)
    .set({ importCursor: cursor.slice(0, 64) })
    .where(scopedToTenant(
      jobPostingDistributions,
      row.tenantId,
      eq(jobPostingDistributions.jobPostingId, row.postingId),
      eq(jobPostingDistributions.connectorKey, row.connectorKey),
    ));
}

export async function touchPostedDistribution(db: Db, row: PostedDistribution): Promise<void> {
  await db
    .update(jobPostingDistributions)
    .set({ updatedAt: sql`now()` })
    .where(scopedToTenant(
      jobPostingDistributions,
      row.tenantId,
      eq(jobPostingDistributions.jobPostingId, row.postingId),
      eq(jobPostingDistributions.connectorKey, row.connectorKey),
    ));
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
