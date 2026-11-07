/**
 * knowledgeSweep — the age sweep of pack sync's storage (PRD 41 A11 rule 4a), run daily by the cron sweep
 * `knowledge-storage` (cronSweeps.ts):
 *
 *   orphan bundles   a bundle object older than `minAgeMs` that no `knowledge_extracted_index` row names. A pack
 *                    writes its bundle BEFORE its transaction commits, so a failed or rolled-back pack leaves one;
 *                    the key is the content, so it is harmless until swept. A referenced bundle is never touched.
 *   expired parts    staged parts of a multi-part pack past their hour, for every project that syncs.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bundlePrefix } from './knowledgeBundles';
import { r2KnowledgeSync } from './sync/knowledgeSyncBlobs';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Projects and tenants swept per run: the rest wait for tomorrow. */
const MAX_SCOPES = 200;
const LIST_PAGE = 1000;

export interface KnowledgeSweepResult { tenants: number; bundlesRemoved: number; projects: number }

export async function sweepKnowledgeStorage(env: Pick<Env, 'UPLOADS'>, db: Db, now: number = Date.now(), minAgeMs: number = DAY_MS): Promise<KnowledgeSweepResult> {
  const result: KnowledgeSweepResult = { tenants: 0, bundlesRemoved: 0, projects: 0 };
  const bucket = env.UPLOADS;
  if (!bucket) return result;
  const scopes = (await db.execute(sql`
    SELECT DISTINCT tenant_id, project_id FROM knowledge_extracted_index
    UNION SELECT DISTINCT tenant_id, project_id FROM knowledge_sources
    LIMIT ${MAX_SCOPES}`)) as unknown as { rows?: Array<{ tenant_id: number; project_id: number }> } & Array<{ tenant_id: number; project_id: number }>;
  const list = scopes.rows ?? scopes;
  const tenants = new Set<number>();
  for (const s of list) {
    tenants.add(s.tenant_id);
    await r2KnowledgeSync({ UPLOADS: bucket }, s.tenant_id, s.project_id).sweepStaged().catch(() => undefined);
    result.projects += 1;
  }
  for (const tenantId of tenants) {
    result.tenants += 1;
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: bundlePrefix(tenantId), limit: LIST_PAGE, ...(cursor ? { cursor } : {}) });
      const old = page.objects.filter((o) => now - o.uploaded.getTime() > minAgeMs).map((o) => o.key);
      if (old.length > 0) {
        const referenced = (await db.execute(sql`
          SELECT DISTINCT bundle_key FROM knowledge_extracted_index
          WHERE tenant_id = ${tenantId} AND bundle_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(old)}::jsonb))`)) as unknown as { rows?: Array<{ bundle_key: string }> } & Array<{ bundle_key: string }>;
        const keep = new Set((referenced.rows ?? referenced).map((r) => r.bundle_key));
        const orphans = old.filter((k) => !keep.has(k));
        if (orphans.length > 0) { await bucket.delete(orphans); result.bundlesRemoved += orphans.length; }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return result;
}
