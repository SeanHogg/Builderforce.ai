/**
 * Collection view contracts (PRD 47 §3.3) — the ONE paging/bulk shape shared
 * by the API routes (which produce them) and the frontend Collection component
 * (which consumes them), so the two sides cannot drift.
 *
 * D1: page sizes are 50 / 100 / 250 (default 50). D7 replaces the old 200.
 * D2: the tenant always comes from the authenticated JWT/context, never the
 * request body — a body tenant id would let a caller act on another tenant.
 * Types only; no runtime dependencies beyond the two constants.
 */

/** Allowed page sizes (PRD 47 D7). */
export const PAGE_SIZES = [50, 100, 250] as const;

/** A page size from the allowed set. */
export type PageSize = (typeof PAGE_SIZES)[number];

/** Hard cap on a single bulk request (PRD 47 D1 — select-all is capped at 1000). */
export const BULK_MAX = 1000;

/** The archived filter: `exclude` (default) hides archived rows, `only` shows only archived, `all` shows both. */
export type ArchivedFilter = 'exclude' | 'only' | 'all';

export interface PageQuery {
  page: number;
  pageSize: PageSize;
  sort: string;
  dir: 'asc' | 'desc';
  archived: ArchivedFilter;
  q?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  dir: 'asc' | 'desc';
}

export type BulkAction = 'delete' | 'archive' | 'restore' | 'merge';

export interface BulkRequest {
  action: BulkAction;
  ids: string[];
  targetId?: string;
  dryRun?: boolean;
}

export type BulkSkipReason = 'not_found' | 'forbidden' | 'builtin' | 'conflict' | 'already';

export interface BulkSkipped {
  id: string;
  reason: BulkSkipReason;
}

export interface BulkResult {
  action: BulkAction;
  succeeded: string[];
  skipped: BulkSkipped[];
  preview?: Record<string, number>;
}
