/**
 * Run-delta reads (PRD 41 §C14) — what the web history card and run page consume (WS10):
 *
 *   GET /api/projects/:projectId/run-deltas?limit=&cursor=  → { items: RunDeltaSummary[]; nextCursor? }  newest first
 *   GET /api/run-deltas/:runId                             → { deltas: StoredRunDelta[] }               one per repo key
 *
 * Read-through cached (`getOrSetCached`) under a per-tenant version token that the sync import bumps after
 * its transaction commits ({@link bumpRunDeltaReads}), so a new delta is visible on the next read. Deltas are
 * immutable, so the only invalidation is "a delta arrived".
 */

import type { RunDeltaSummary, StoredRunDelta } from '@builderforce/run-delta';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { bumpCacheVersionSafe, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { RunDeltaEvidenceStore, RunDeltaPage } from './runDeltaPorts';
import { listProjectRunDeltas, runDeltasOfRun, type RunDeltaCursor } from './runDeltaStore';

export const RUN_DELTA_PAGE_DEFAULT = 50;
export const RUN_DELTA_PAGE_MAX = 100;
const KV_TTL_SECONDS = 300;

/** A `run_deltas.id` (gen_random_uuid): strict 8-4-4-4-12 hex. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const runDeltaVersionKey =(tenantId: number): string => `run-deltas-version:tenant:${tenantId}`;

/** Orphan every cached run-delta read of a tenant. Best-effort (never throws). */
export function bumpRunDeltaReads(env: Env | undefined, tenantId: number): Promise<void> {
  return bumpCacheVersionSafe(env, runDeltaVersionKey(tenantId), 'bumpRunDeltaReads', { tenantId });
}

/** Opaque keyset cursor: base64url of `<computedAt ISO>|<id>`. Null when absent or malformed. */
export function decodeRunDeltaCursor(raw: string | undefined | null): RunDeltaCursor | null {
  if (!raw) return null;
  try {
    const text = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const bar = text.indexOf('|');
    const computedAt = text.slice(0, bar);
    const id = text.slice(bar + 1);
    if (bar <= 0 || Number.isNaN(Date.parse(computedAt)) || !UUID.test(id)) return null;
    return { computedAt, id };
  } catch {
    return null;
  }
}

export function encodeRunDeltaCursor(cursor: RunDeltaCursor): string {
  return btoa(`${cursor.computedAt}|${cursor.id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const strip = ({ id: _id, ...summary }: RunDeltaSummary & { id: string }): RunDeltaSummary => summary;

/** One page of a project's deltas, newest first. The caller has already gated the project to the tenant. */
export async function listRunDeltasForProject(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  projectId: number,
  opts: { limit: number; cursor: RunDeltaCursor | null },
): Promise<RunDeltaPage> {
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit)), RUN_DELTA_PAGE_MAX);
  const version = env ? await getCacheVersion(env, runDeltaVersionKey(tenantId)) : '0';
  const cursorKey = opts.cursor ? encodeRunDeltaCursor(opts.cursor) : '';
  return getOrSetCached(env, `run-deltas:project:${tenantId}:${projectId}:${limit}:${cursorKey}:v:${version}`, async () => {
    const rows = await listProjectRunDeltas(db, tenantId, projectId, limit, opts.cursor);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(strip),
      ...(rows.length > limit && last ? { nextCursor: encodeRunDeltaCursor({ computedAt: last.computedAt, id: last.id }) } : {}),
    };
  }, { kvTtlSeconds: KV_TTL_SECONDS });
}

/**
 * Every stored delta of one run, with the full delta from the evidence store. Only the SUMMARY rows go through the
 * read-through cache; the evidence blobs are read from R2 on every call — they can be large, they are already
 * content-addressed, and a copy in KV or isolate memory would only duplicate them. A delta whose blob is missing
 * (expired from R2) is left out rather than shown without its findings.
 */
export async function runDeltasForRun(
  env: Env | undefined,
  db: Db,
  evidence: RunDeltaEvidenceStore,
  tenantId: number,
  runId: string,
): Promise<{ deltas: StoredRunDelta[] }> {
  const version = env ? await getCacheVersion(env, runDeltaVersionKey(tenantId)) : '0';
  const rows = await getOrSetCached(env, `run-deltas:run:${tenantId}:${runId}:v:${version}`,
    async () => (await runDeltasOfRun(db, tenantId, runId)).map(strip), { kvTtlSeconds: KV_TTL_SECONDS });
  const full = await Promise.all(rows.map(async (row) => {
    const delta = await evidence.get(tenantId, row.digest);
    return delta ? { ...row, delta } : null;
  }));
  return { deltas: full.filter((d): d is StoredRunDelta => d !== null) };
}
