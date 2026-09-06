/**
 * Record import — the typed client for `/api/import/*`.
 *
 * ONE contract, shared with the Brain's `board_data.*` tools:
 *
 *   GET  /api/import/kinds   → { kinds: [{ key, columns: [{ name, type, required, example? }] }] }
 *   POST /api/import/:kind   { rows, dryRun?, rowOffset? } → ImportResult
 *
 * The POST answers 201 when rows were written, 200 for a dry run, and 400 when
 * NOTHING could be written — and that 400 still carries a real `ImportResult`
 * (what was skipped and why). `apiRequest` throws on any non-2xx and keeps only
 * an error envelope, so this goes through `apiRequestStream` — the one transport
 * that hands the Response back — and reads the body itself. `expectedErrors`
 * keeps the 400 off the global fault toast: a file whose every row is missing a
 * required column is the user's problem to read on screen, not a system fault.
 */

import { ApiRequestError, apiRequest, apiRequestStream } from '@/lib/apiClient';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';

export type ImportColumnType = 'string' | 'number' | 'bool' | 'dateString' | 'timestamp';

export interface ImportKindColumn {
  name: string;
  type: ImportColumnType;
  required: boolean;
  /** A realistic value, from the server registry — the CSV template's example
   *  row and the wizard's placeholder both come from here. */
  example?: string;
}

export interface ImportKind {
  key: string;
  columns: ImportKindColumn[];
}

export interface ImportResult {
  /** Rows written — or, when `dryRun`, rows that WOULD be written. */
  inserted: number;
  skipped: number;
  /** `row N: …`, numbered from `rowOffset + 1`. */
  errors: string[];
  dryRun: boolean;
}

export interface ImportRowsOptions {
  /** Validate every row server-side and write nothing. */
  dryRun?: boolean;
  /** Rows already sent ahead of this batch, so `row N` errors count from the file. */
  rowOffset?: number;
}

/** The server caps one POST at 2000 rows; the page posts well under it so a
 *  progress bar has something honest to show. */
export const IMPORT_BATCH_SIZE = 500;

const KINDS_CACHE_KEY = 'import:kinds';
const KINDS_TTL_MS = 60 * 60 * 1000;

/** The registry is static per deploy; every mount in a tab shares one read. */
export function listImportKinds(): Promise<ImportKind[]> {
  return getOrSetClientCached(
    KINDS_CACHE_KEY,
    async () => (await apiRequest<{ kinds: ImportKind[] }>('/api/import/kinds')).kinds,
    { ttlMs: KINDS_TTL_MS },
  );
}

function isImportResult(value: unknown): value is ImportResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.inserted === 'number' && typeof v.skipped === 'number' && Array.isArray(v.errors);
}

export async function importRows(
  kind: string,
  rows: Array<Record<string, unknown>>,
  opts: ImportRowsOptions = {},
): Promise<ImportResult> {
  const res = await apiRequestStream(`/api/import/${encodeURIComponent(kind)}`, {
    method: 'POST',
    body: JSON.stringify({ rows, dryRun: opts.dryRun === true, rowOffset: opts.rowOffset ?? 0 }),
    expectedErrors: [400],
  });
  const body: unknown = await res.json().catch(() => null);
  if ((res.ok || res.status === 400) && isImportResult(body)) return body;
  const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : `Import failed (${res.status})`;
  throw new ApiRequestError(message, res.status);
}
