import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const mocks = vi.hoisted(() => ({
  invalidateBoardLaneOrdinals: vi.fn().mockResolvedValue(undefined),
  invalidateSwimlaneOrdinals: vi.fn().mockResolvedValue(undefined),
  invalidateBoardLanesCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./laneOrdinals', () => ({
  invalidateBoardLaneOrdinals: mocks.invalidateBoardLaneOrdinals,
  invalidateSwimlaneOrdinals: mocks.invalidateSwimlaneOrdinals,
}));
vi.mock('./boardReads', () => ({ invalidateBoardLanesCache: mocks.invalidateBoardLanesCache }));

import { deleteBoardRow, updateBoardRow } from './boardWrites';

const env = {} as Env;

function dbReturning(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ returning }));
  return {
    db: {
      update: () => ({ set: () => ({ where }) }),
      delete: () => ({ where }),
    } as unknown as Db,
  };
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockClear());
});

describe('updateBoardRow', () => {
  it('drops the lane-router / ordinal caches after a board update', async () => {
    const { db } = dbReturning([{ id: 'b1' }]);
    const row = await updateBoardRow(env, db, { tenantId: 7, boardId: 'b1', patch: { name: 'x' } });
    expect(row).toEqual({ id: 'b1' });
    expect(mocks.invalidateBoardLaneOrdinals).toHaveBeenCalledWith(env, db, 'b1');
  });

  it('invalidates nothing when no row matched', async () => {
    const { db } = dbReturning([]);
    expect(await updateBoardRow(env, db, { tenantId: 7, boardId: 'b1', patch: { name: 'x' } })).toBeUndefined();
    expect(mocks.invalidateBoardLaneOrdinals).not.toHaveBeenCalled();
  });
});

describe('deleteBoardRow', () => {
  it('drops the project routing cache for the deleted board, keyed by tenant, from the delete RETURNING', async () => {
    const { db } = dbReturning([{ projectId: 42 }]);
    expect(await deleteBoardRow(env, db, { tenantId: 7, boardId: 'b1' })).toBe(true);
    expect(mocks.invalidateSwimlaneOrdinals).toHaveBeenCalledWith(env, 42, 7);
    expect(mocks.invalidateBoardLanesCache).toHaveBeenCalledWith(env, 7, 'b1');
  });

  it('does nothing when no board was deleted', async () => {
    const { db } = dbReturning([]);
    expect(await deleteBoardRow(env, db, { tenantId: 7, boardId: 'b1' })).toBe(false);
    expect(mocks.invalidateSwimlaneOrdinals).not.toHaveBeenCalled();
  });
});
