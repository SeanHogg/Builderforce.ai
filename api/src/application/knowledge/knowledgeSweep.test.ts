/**
 * knowledgeSweep (PRD 41 A11 rule 4a): the index-row delete runs under the project's sync lock (so a pack that verified a
 * body under that lock cannot lose its row behind it), and an orphan bundle is deleted right after its OWN age check.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { sweepKnowledgeStorage } from './knowledgeSweep';
import { KnowledgeSyncError } from './sync/knowledgeSyncPorts';

vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn(), reportedFallback: (fallback: unknown) => () => fallback }));

const NOW = Date.UTC(2026, 10, 7);
const DAY = 24 * 60 * 60 * 1000;

function fixture(headAge: Record<string, number | null>) {
  const deleted: unknown[] = [];
  const order: string[] = [];
  const bundleKeys = Object.keys(headAge);
  const bucket = {
    get: async () => null,
    put: async () => undefined,
    head: async (key: string) => { order.push(`head:${key}`); const age = headAge[key]; return age === null || age === undefined ? null : { uploaded: new Date(NOW - age) }; },
    delete: async (k: unknown) => { order.push(`delete:${String(k)}`); deleted.push(k); },
    list: async (o: { prefix: string }) => ({
      objects: o.prefix.includes('extracted-bundles') ? bundleKeys.map((key) => ({ key, uploaded: new Date(NOW - 5 * DAY) })) : [],
      truncated: false,
    }),
  } as unknown as R2Bucket;
  const statements: string[] = [];
  let first = true;
  const run = async (): Promise<{ rows: unknown[] }> => {
    if (first) { first = false; return { rows: [{ tenant_id: 1, project_id: 2 }] }; }
    return { rows: [] };
  };
  const tx = { execute: async (q: unknown) => { statements.push(JSON.stringify((q as { queryChunks?: unknown }).queryChunks ?? '').slice(0, 400)); return { rows: [], rowCount: 0 }; } };
  const db = { execute: run, transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx) } as unknown as Db;
  return { bucket, db, deleted, order, statements };
}

describe('sweepKnowledgeStorage', () => {
  it('deletes the old index rows inside a transaction that first takes the project sync lock', async () => {
    const f = fixture({});
    await sweepKnowledgeStorage({ UPLOADS: f.bucket }, f.db, NOW);
    expect(f.statements.length).toBeGreaterThanOrEqual(4);
    expect(f.statements[0]).toContain('lock_timeout');
    expect(f.statements[1]).toContain('pg_advisory_xact_lock');
    expect(f.statements[2]).toContain('lock_timeout = DEFAULT');
    expect(f.statements[3]).toContain('DELETE FROM knowledge_extracted_index');
  });

  it('continues to the next project and the bundle sweep when one project reports sync_busy', async () => {
    const f = fixture({ 'knowledge/1/extracted-bundles/old': 3 * DAY });
    let scopeQueries = 0;
    const attempted: number[] = [];
    const db = {
      execute: async () => (scopeQueries++ === 0 ? { rows: [{ tenant_id: 1, project_id: 2 }, { tenant_id: 1, project_id: 3 }] } : { rows: [] }),
      transaction: async (work: (t: unknown) => Promise<unknown>) => {
        attempted.push(attempted.length + 2);
        if (attempted.length === 1) throw new KnowledgeSyncError(503, 'sync_busy', 'busy', { retryAfterSeconds: 5 });
        return work({ execute: async () => ({ rows: [], rowCount: 0 }) });
      },
    } as unknown as Db;
    const result = await sweepKnowledgeStorage({ UPLOADS: f.bucket }, db, NOW);
    expect(attempted).toHaveLength(2); // the second project was still attempted
    expect(result.projects).toBe(2);
    expect(result.bundlesRemoved).toBe(1); // and the bundle sweep still ran
  });

  it('deletes each orphan bundle right after its own HEAD check, and keeps one that a retried pack made young again', async () => {
    const f = fixture({ 'knowledge/1/extracted-bundles/old': 3 * DAY, 'knowledge/1/extracted-bundles/reput': 60_000 });
    const result = await sweepKnowledgeStorage({ UPLOADS: f.bucket }, f.db, NOW);
    expect(result.bundlesRemoved).toBe(1);
    expect(f.deleted).toEqual(['knowledge/1/extracted-bundles/old']); // one key per delete call, never a batch
    expect(f.order.indexOf('delete:knowledge/1/extracted-bundles/old')).toBe(f.order.indexOf('head:knowledge/1/extracted-bundles/old') + 1);
  });
});
