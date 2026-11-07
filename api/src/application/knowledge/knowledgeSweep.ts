/**
 * knowledgeSweep — the age sweep of pack sync's storage (PRD 41 A11 rules 4a-4b), run daily by the cron sweep
 * `knowledge-storage` (cronSweeps.ts):
 *
 *   orphan bundles   a bundle object older than `minAgeMs` that no `knowledge_extracted_index` row names. A pack
 *                    writes its bundle BEFORE its transaction commits, so a failed or rolled-back pack leaves one;
 *                    the key is the content, so it is harmless until swept. Re-checked just before each delete: the
 *                    object's current upload time (a retried pack re-puts the same key) and, again, the index.
 *   expired parts    staged parts of a multi-part pack past their hour.
 *   old index rows   rows of the index whose hash no source row names any more (a deleted root), older than 90 days
 *                    (a review snapshot can still name an old hash for Compare): their bundles become orphans.
 *
 * One run covers at most `MAX_SCOPES` (tenant, project) pairs, in key order from a CURSOR kept in R2, so every pair
 * is reached over the days instead of the same first 200 every time.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { reportCaughtError, reportedFallback } from '../observability/caughtErrorReporter';
import { bundlePrefix } from './knowledgeBundles';
import { drizzleLedger, rowsOf } from './knowledgeLedger';
import { r2KnowledgeSync } from './sync/knowledgeSyncBlobs';

const DAY_MS = 24 * 60 * 60 * 1000;
const INDEX_ROW_MAX_AGE_DAYS = 90;
/** Projects swept per run: the rest wait for the next. */
const MAX_SCOPES = 200;
const LIST_PAGE = 1000;
/** Removal markers retried per project per run. */
const MARKERS_PER_RUN = 1000;
const CURSOR_KEY = 'knowledge/sweep-cursor.json';

export interface KnowledgeSweepResult { tenants: number; bundlesRemoved: number; projects: number; indexRowsRemoved: number }

interface Cursor { tenantId: number; projectId: number }

async function readCursor(bucket: R2Bucket): Promise<Cursor> {
  try {
    const obj = await bucket.get(CURSOR_KEY);
    const c = obj ? ((await obj.json()) as Partial<Cursor>) : undefined;
    if (c && Number.isInteger(c.tenantId) && Number.isInteger(c.projectId)) return { tenantId: c.tenantId!, projectId: c.projectId! };
  } catch (error) {
    // an unreadable cursor starts over
    reportCaughtError(error, { source: 'application/knowledge/knowledgeSweep.ts', operation: 'readCursor', level: 'warning' });
  }
  return { tenantId: 0, projectId: 0 };
}

async function sweepTenantBundles(bucket: R2Bucket, db: Db, tenantId: number, now: number, minAgeMs: number): Promise<number> {
  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: bundlePrefix(tenantId), limit: LIST_PAGE, ...(cursor ? { cursor } : {}) });
    const old = page.objects.filter((o) => now - o.uploaded.getTime() > minAgeMs).map((o) => o.key);
    if (old.length > 0) {
      const referenced = rowsOf<{ bundle_key: string }>(await db.execute(sql`
        SELECT DISTINCT bundle_key FROM knowledge_extracted_index
        WHERE tenant_id = ${tenantId} AND bundle_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(old)}::jsonb))`));
      const keep = new Set(referenced.map((r) => r.bundle_key));
      const doomed: string[] = [];
      for (const key of old.filter((k) => !keep.has(k))) {
        // Just before the delete: a retried pack re-puts the same key, which makes the object young again.
        const head = await bucket.head(key);
        if (head && now - head.uploaded.getTime() > minAgeMs) doomed.push(key);
      }
      if (doomed.length > 0) { await bucket.delete(doomed); removed += doomed.length; }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return removed;
}

/**
 * Retries the legacy per-source deletes of removed sources (NEW-M4): a pack marks a removal in its transaction and
 * deletes the legacy object after the commit, best effort. Here the object is deleted again and, only once that
 * succeeded, the marker goes. Until then the marker keeps the source out of every listing.
 */
async function sweepRemovedSources(db: Db, sync: ReturnType<typeof r2KnowledgeSync>, tenantId: number, projectId: number): Promise<void> {
  const ledger = drizzleLedger(db, tenantId, projectId);
  const markers = await ledger.sources.markers(MARKERS_PER_RUN);
  const byRoot = new Map<string, string[]>();
  for (const m of markers) byRoot.set(m.rootId, [...(byRoot.get(m.rootId) ?? []), m.sourceId]);
  const done: Array<{ rootId: string; sourceId: string }> = [];
  for (const [rootId, ids] of byRoot) {
    try {
      await sync.deleteLegacySources(rootId, ids);
      done.push(...ids.map((sourceId) => ({ rootId, sourceId })));
    } catch (error) {
      // kept: the marker stays and the next run retries
      reportCaughtError(error, { source: 'application/knowledge/knowledgeSweep.ts', operation: 'deleteLegacySources', level: 'warning', context: { rootId } });
    }
  }
  await ledger.sources.dropMarkers(done);
}

export async function sweepKnowledgeStorage(env: Pick<Env, 'UPLOADS'>, db: Db, now: number = Date.now(), minAgeMs: number = DAY_MS): Promise<KnowledgeSweepResult> {
  const result: KnowledgeSweepResult = { tenants: 0, bundlesRemoved: 0, projects: 0, indexRowsRemoved: 0 };
  const bucket = env.UPLOADS;
  if (!bucket) return result;
  const from = await readCursor(bucket);
  // A cursor over the tables' own primary-key order: each branch reads at most MAX_SCOPES rows past the cursor (an ordered
  // index scan with DISTINCT ON), never every (tenant, project) of two whole tables.
  const branch = (table: ReturnType<typeof sql.raw>) => sql`
    (SELECT DISTINCT ON (tenant_id, project_id) tenant_id, project_id FROM ${table}
     WHERE (tenant_id, project_id) > (${from.tenantId}, ${from.projectId})
     ORDER BY tenant_id, project_id LIMIT ${MAX_SCOPES})`;
  const scopes = rowsOf<{ tenant_id: number; project_id: number }>(await db.execute(sql`
    SELECT tenant_id, project_id FROM (
      ${branch(sql.raw('knowledge_extracted_index'))} UNION ${branch(sql.raw('knowledge_sources'))} UNION ${branch(sql.raw('knowledge_sync_roots'))}
    ) s ORDER BY tenant_id, project_id LIMIT ${MAX_SCOPES}`));

  const tenants = new Set<number>();
  for (const s of scopes) {
    tenants.add(s.tenant_id);
    const sync = r2KnowledgeSync({ UPLOADS: bucket }, s.tenant_id, s.project_id, drizzleLedger(db, s.tenant_id, s.project_id));
    const scope = { tenantId: s.tenant_id, projectId: s.project_id };
    await sync.sweepStaged().catch(reportedFallback(undefined, { source: 'application/knowledge/knowledgeSweep.ts', operation: 'sweepStaged', context: scope }));
    await sweepRemovedSources(db, sync, s.tenant_id, s.project_id).catch(reportedFallback(undefined, { source: 'application/knowledge/knowledgeSweep.ts', operation: 'sweepRemovedSources', context: scope }));
    const gone = await db.execute(sql`
      DELETE FROM knowledge_extracted_index i
      WHERE i.tenant_id = ${s.tenant_id} AND i.project_id = ${s.project_id}
        AND i.created_at < now() - make_interval(days => ${INDEX_ROW_MAX_AGE_DAYS})
        AND NOT EXISTS (SELECT 1 FROM knowledge_sources k WHERE k.tenant_id = i.tenant_id AND k.project_id = i.project_id AND k.hash = i.hash)`);
    result.indexRowsRemoved += (gone as unknown as { rowCount?: number }).rowCount ?? 0;
    result.projects += 1;
  }
  for (const tenantId of tenants) {
    result.tenants += 1;
    result.bundlesRemoved += await sweepTenantBundles(bucket, db, tenantId, now, minAgeMs);
  }
  // A short batch means the end was reached: the next run starts over.
  const last = scopes[scopes.length - 1];
  const next = scopes.length < MAX_SCOPES || !last ? { tenantId: 0, projectId: 0 } : { tenantId: last.tenant_id, projectId: last.project_id };
  await bucket.put(CURSOR_KEY, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } });
  return result;
}
