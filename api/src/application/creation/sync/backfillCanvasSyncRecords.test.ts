import { describe, expect, it } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { creationSessionConnections, creationSessionObjects, creationSessions } from '../../../infrastructure/database/schema';
import { syncRecords } from '../../../infrastructure/database/schema/sync';
import { backfillCanvasSyncPage } from './backfillCanvasSyncRecords';
import { canvasProjectionScope } from './canvasSyncProjection';

const NOW = new Date('2026-11-25T10:00:00Z');
const boardIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

/** A db whose reads answer from fixed rows and which records every query by table, and every insert. */
function stubDb() {
  const reads: string[] = [];
  const inserts: string[] = [];
  const rowsFor = (table: unknown): unknown[] => {
    if (table === creationSessions) return boardIds.map((id) => ({ id, title: 'T', mode: 'chat', status: 'active', updatedAt: NOW }));
    if (table === creationSessionObjects) return boardIds.map((sessionId, n) => ({ id: `0000000${n}-0000-4000-8000-000000000000`, sessionId, kind: 'note', resourceType: null, resourceId: null, resourceRevision: null, canvasData: {}, content: null, updatedAt: NOW }));
    return [];
  };
  const select = () => ({
    from: (table: unknown) => {
      reads.push(getTableName(table as never));
      const result = Promise.resolve(rowsFor(table));
      const chain: Record<string, unknown> = {};
      for (const name of ['where', 'orderBy', 'limit']) chain[name] = () => Object.assign(Promise.resolve(rowsFor(table)), chain);
      return Object.assign(result, chain);
    },
  });
  const tx = {
    insert: (table: unknown) => ({
      values: () => {
        inserts.push(table === syncRecords ? 'sync_records' : 'sync_changes');
        const done = Promise.resolve([]);
        return Object.assign(done, { onConflictDoUpdate: () => done });
      },
    }),
  };
  return { reads, inserts, db: { select, transaction: (work: (t: unknown) => Promise<unknown>) => work(tx) } as never };
}

describe('backfillCanvasSyncPage', () => {
  it('reads each table once for the whole page and writes with two inserts', async () => {
    const { db, reads, inserts } = stubDb();
    const page = await backfillCanvasSyncPage(db, canvasProjectionScope(7), { limit: 2, now: NOW });
    expect(reads.filter((t) => t === 'creation_sessions')).toHaveLength(1);
    expect(reads.filter((t) => t === getTableName(creationSessionObjects))).toHaveLength(1);
    expect(reads.filter((t) => t === getTableName(creationSessionConnections))).toHaveLength(1);
    expect(reads.filter((t) => t === 'sync_records')).toHaveLength(1);
    expect(inserts).toEqual(['sync_records', 'sync_changes']);
    expect(page).toMatchObject({ boards: 2, written: 4, dryRun: false, nextAfterId: boardIds[1] });
  });

  it('plans but does not write on a dry run, and ends when the page is short', async () => {
    const { db, inserts } = stubDb();
    const page = await backfillCanvasSyncPage(db, canvasProjectionScope(7), { limit: 100, dryRun: true, now: NOW });
    expect(inserts).toEqual([]);
    expect(page).toMatchObject({ dryRun: true, written: 4, nextAfterId: null });
  });
});
