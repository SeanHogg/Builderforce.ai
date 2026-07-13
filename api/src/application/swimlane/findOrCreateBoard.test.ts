import { describe, expect, it } from 'vitest';
import { findOrCreateBoard, buildDefaultLaneRows } from './findOrCreateBoard';
import { DEFAULT_SWIMLANES } from './defaultSwimlanes';
import { boards, swimlanes } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

type TableRef = typeof boards | typeof swimlanes;

/**
 * Minimal chainable fake of the Drizzle Db surface used by findOrCreateBoard.
 * select().from(boards)...limit() resolves to the queued board rows; the insert
 * chain records what was written and echoes an id'd row.
 */
function makeFakeDb(existingBoards: unknown[], opts: { failLaneSeed?: boolean } = {}) {
  const inserts: Array<{ table: TableRef; values: unknown }> = [];
  const deletes: TableRef[] = [];

  function selectChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    chain.from = passthrough;
    chain.where = passthrough;
    chain.orderBy = passthrough;
    chain.limit = passthrough;
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
    return chain;
  }

  const db = {
    select() {
      return {
        from(table: TableRef) {
          return selectChain(table === boards ? existingBoards : []);
        },
      };
    },
    insert(table: TableRef) {
      return {
        values(values: unknown) {
          inserts.push({ table, values });
          if (table === swimlanes && opts.failLaneSeed) {
            return Promise.reject(new Error('lane seed boom'));
          }
          if (table === boards) {
            return {
              returning: () => Promise.resolve([{ id: 'board-new', ...(values as object) }]),
            };
          }
          return Promise.resolve(undefined);
        },
      };
    },
    delete(table: TableRef) {
      deletes.push(table);
      return { where: () => ({ catch: () => Promise.resolve() }) };
    },
  };

  return { db: db as unknown as Db, inserts, deletes };
}

describe('findOrCreateBoard', () => {
  it('returns the existing board (created=false) without inserting when one exists', async () => {
    const existing = { id: 'board-1', tenantId: 1, projectId: 7, name: 'Old' };
    const { db, inserts } = makeFakeDb([existing]);

    const res = await findOrCreateBoard(db, { tenantId: 1, projectId: 7, name: 'New name' });

    expect(res.created).toBe(false);
    expect(res.board).toBe(existing);
    expect(inserts).toHaveLength(0);
  });

  it('inserts a new board + seeds default lanes (created=true) when none exists', async () => {
    const { db, inserts } = makeFakeDb([]);

    const res = await findOrCreateBoard(db, { tenantId: 1, projectId: 7, name: '  Board  ' });

    expect(res.created).toBe(true);
    expect(res.board.id).toBe('board-new');
    const boardInsert = inserts.find((i) => i.table === boards);
    expect((boardInsert?.values as { name: string }).name).toBe('Board'); // trimmed
    const laneInsert = inserts.find((i) => i.table === swimlanes);
    expect((laneInsert?.values as unknown[]).length).toBe(DEFAULT_SWIMLANES.length);
  });

  it('does NOT seed lanes when seedDefaultLanes is false', async () => {
    const { db, inserts } = makeFakeDb([]);
    await findOrCreateBoard(db, { tenantId: 1, projectId: 7, name: 'B', seedDefaultLanes: false });
    expect(inserts.find((i) => i.table === swimlanes)).toBeUndefined();
  });

  it('rolls the board back (compensating delete) when the lane seed fails', async () => {
    const { db, deletes } = makeFakeDb([], { failLaneSeed: true });
    await expect(findOrCreateBoard(db, { tenantId: 1, projectId: 7, name: 'B' })).rejects.toThrow('lane seed boom');
    expect(deletes).toContain(boards);
  });
});

describe('buildDefaultLaneRows', () => {
  it('maps every default swimlane onto the board/tenant/segment', () => {
    const now = new Date();
    const rows = buildDefaultLaneRows(3, 'seg-1', 'board-9', now);
    expect(rows).toHaveLength(DEFAULT_SWIMLANES.length);
    expect(rows[0]).toMatchObject({ tenantId: 3, segmentId: 'seg-1', boardId: 'board-9', key: DEFAULT_SWIMLANES[0]!.key });
  });
});
