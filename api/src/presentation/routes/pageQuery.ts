/**
 * `parsePageQuery` — the ONE reading of a Collection page request (PRD 47 §3.3).
 *
 * Built on the existing `limitParam` / `offsetParam` so a junk or malicious
 * value is clamped exactly the way the rest of the platform clamps one — a
 * `?page=abc` becomes page 1, a `?pageSize=999999` becomes 250, never a NaN or
 * a giant LIMIT reaching Postgres.
 *
 * Sorting is allowlisted: the caller passes `sorts`, a map from a public sort
 * key to the Drizzle column it orders by, and `defaultSort`. A `?sort=` outside
 * the allowlist is a 400, never silently ignored — a misspelled key must not
 * fall back to "some order" and look like it worked.
 *
 * The archived filter maps to the uniform `archived=exclude|only|all` tri-state
 * the Collection surfaces send. `exclude` (default) keeps `archived_at IS NULL`
 * rows, `only` keeps the archived ones, `all` keeps both.
 */
import type { Context } from 'hono';
import type { SQL } from 'drizzle-orm';
import { asc, desc, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { limitParam, offsetParam } from '../../domain/shared/boundedInt';
import { ValidationError } from '../../domain/shared/errors';
import { PAGE_SIZES, type ArchivedFilter } from '@builderforce/interaction-contract';

/** Default page size (PRD 47 D7). */
const DEFAULT_PAGE_SIZE: number = PAGE_SIZES[0]!;
/** Largest page size (PRD 47 D7). */
const MAX_PAGE_SIZE: number = PAGE_SIZES[PAGE_SIZES.length - 1]!;

export interface ParsePageQueryOptions {
  /** Public sort key → column. `?sort=` must be one of these, else 400. */
  sorts: Record<string, PgColumn | Parameters<typeof asc>[0]>;
  /** Applied when `?sort=` is absent (or when `sorts` has exactly one entry). */
  defaultSort: { key: string; dir: 'asc' | 'desc' };
}

export interface ParsedPageQuery {
  limit: number;
  offset: number;
  orderBy: SQL;
  /** The archived tri-state the caller asked for (default `exclude`). */
  archived: ArchivedFilter;
  /** Lowercased, trimmed `?q=`, or undefined when absent/blank. */
  q?: string;
}

export function parsePageQuery(c: Context, opts: ParsePageQueryOptions): ParsedPageQuery {
  const page = offsetParam(c.req.query('page')) || 1;
  const pageSizeRaw = limitParam(c.req.query('pageSize'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const limit = PAGE_SIZES.includes(pageSizeRaw as (typeof PAGE_SIZES)[number])
    ? pageSizeRaw
    : DEFAULT_PAGE_SIZE;
  const offset = (Math.max(1, page) - 1) * limit;

  const sortKey = c.req.query('sort') ?? opts.defaultSort.key;
  const column = opts.sorts[sortKey];
  if (!column) {
    throw new ValidationError(`Unknown sort key '${sortKey}'. Allowed: ${Object.keys(opts.sorts).join(', ')}`);
  }
  const dirRaw = (c.req.query('dir') ?? opts.defaultSort.dir).toLowerCase();
  const dir = dirRaw === 'desc' ? 'desc' : 'asc';
  // `asc`/`desc` accept both a `PgColumn` and a `SQL` fragment (a builder from
  // `integer('updated_at')` is fine — Drizzle unwraps it at query build time).
  const orderBy = dir === 'desc' ? desc(column as PgColumn) : asc(column as PgColumn);

  const archivedRaw = (c.req.query('archived') ?? 'exclude').toLowerCase();
  const archived: ArchivedFilter =
    archivedRaw === 'only' || archivedRaw === 'all' ? archivedRaw : 'exclude';

  const qRaw = c.req.query('q');
  const q = qRaw && qRaw.trim() ? qRaw.trim().toLowerCase() : undefined;

  return { limit, offset, orderBy, archived, q };
}
