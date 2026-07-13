import { describe, expect, it } from 'vitest';
import {
  pickFallbackLane,
  reassignTasksFromLane,
  type SurvivingLane,
} from './reassignOrphanedTasks';
import { boards, tasks } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

describe('pickFallbackLane', () => {
  it('returns null when there is no surviving lane', () => {
    expect(pickFallbackLane([])).toBeNull();
  });

  it('picks the lowest-position non-terminal lane', () => {
    const survivors: SurvivingLane[] = [
      { key: 'done', position: 6, isTerminal: true },
      { key: 'in_progress', position: 3, isTerminal: false },
      { key: 'todo', position: 1, isTerminal: false },
    ];
    expect(pickFallbackLane(survivors)).toBe('todo');
  });

  it('falls back to the lowest-position lane when every survivor is terminal', () => {
    const survivors: SurvivingLane[] = [
      { key: 'archived', position: 9, isTerminal: true },
      { key: 'done', position: 6, isTerminal: true },
    ];
    expect(pickFallbackLane(survivors)).toBe('done');
  });
});

type TableRef = typeof boards | typeof tasks;

/**
 * Minimal chainable Db fake: select().from(boards)…→ the board row; update(tasks)
 * records the SET payload and returning() echoes the matched task ids.
 */
function makeFakeDb(opts: { boardProjectId?: number; matchedTaskIds?: number[] }) {
  const updates: Array<{ table: TableRef; set: unknown }> = [];

  const db = {
    select() {
      return {
        from(_table: TableRef) {
          const chain: Record<string, unknown> = {};
          chain.where = () =>
            opts.boardProjectId != null ? [{ projectId: opts.boardProjectId }] : [];
          return chain;
        },
      };
    },
    update(table: TableRef) {
      return {
        set(values: unknown) {
          updates.push({ table, set: values });
          return {
            where: () => ({
              returning: () => Promise.resolve((opts.matchedTaskIds ?? []).map((id) => ({ id }))),
            }),
          };
        },
      };
    },
  };

  return { db: db as unknown as Db, updates };
}

describe('reassignTasksFromLane', () => {
  const survivors: SurvivingLane[] = [
    { key: 'todo', position: 1, isTerminal: false },
    { key: 'done', position: 6, isTerminal: true },
  ];

  it('moves orphaned tasks onto the fallback lane and reports the count', async () => {
    const { db, updates } = makeFakeDb({ boardProjectId: 42, matchedTaskIds: [1, 2, 3] });
    const res = await reassignTasksFromLane(db, {
      tenantId: 1,
      boardId: 'board-1',
      deletedLaneKey: 'in_progress',
      survivors,
    });
    expect(res).toEqual({ movedTo: 'todo', movedCount: 3 });
    expect((updates[0]?.set as { status: string }).status).toBe('todo');
  });

  it('no-ops when there is no surviving lane to move to', async () => {
    const { db, updates } = makeFakeDb({ boardProjectId: 42, matchedTaskIds: [1] });
    const res = await reassignTasksFromLane(db, {
      tenantId: 1,
      boardId: 'board-1',
      deletedLaneKey: 'in_progress',
      survivors: [],
    });
    expect(res).toEqual({ movedTo: null, movedCount: 0 });
    expect(updates).toHaveLength(0);
  });

  it('no-ops when the fallback would be the deleted lane itself', async () => {
    const { db, updates } = makeFakeDb({ boardProjectId: 42, matchedTaskIds: [1] });
    const res = await reassignTasksFromLane(db, {
      tenantId: 1,
      boardId: 'board-1',
      deletedLaneKey: 'todo', // same as the only-active survivor's key
      survivors: [{ key: 'todo', position: 1, isTerminal: false }],
    });
    expect(res).toEqual({ movedTo: null, movedCount: 0 });
    expect(updates).toHaveLength(0);
  });

  it('no-ops when the board cannot be resolved', async () => {
    const { db, updates } = makeFakeDb({ boardProjectId: undefined });
    const res = await reassignTasksFromLane(db, {
      tenantId: 1,
      boardId: 'missing',
      deletedLaneKey: 'in_progress',
      survivors,
    });
    expect(res).toEqual({ movedTo: null, movedCount: 0 });
    expect(updates).toHaveLength(0);
  });
});
