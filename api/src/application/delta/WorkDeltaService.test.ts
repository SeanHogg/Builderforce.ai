import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  linkTicket: vi.fn(),
  resolveSegment: vi.fn(),
  resolveActorByRef: vi.fn(),
  recordActivity: vi.fn(),
}));

vi.mock('../task/TaskService', () => ({
  TaskService: class {
    createTask = mocks.createTask;
  },
}));

vi.mock('../brain/ChatTicketService', () => ({
  ChatTicketService: class {
    linkTicket = mocks.linkTicket;
  },
}));

vi.mock('../../infrastructure/auth/segmentResolver', () => ({
  resolveSegment: mocks.resolveSegment,
}));

vi.mock('../activity/activityLog', () => ({
  resolveActorByRef: mocks.resolveActorByRef,
  recordActivity: mocks.recordActivity,
}));

import { WorkDeltaService } from './WorkDeltaService';

describe('WorkDeltaService ticket deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSegment.mockResolvedValue('00000000-0000-0000-0000-000000000001');
    mocks.resolveActorByRef.mockResolvedValue({ type: 'user', id: 'user-1' });
    mocks.recordActivity.mockResolvedValue(undefined);
    mocks.linkTicket.mockResolvedValue({});
  });

  /** A DB whose existing-ticket lookup finds #1377 and whose delta insert records its row. */
  function existingTicketDb(inserted: Record<string, unknown>[] = []): Db {
    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([{ id: 1377, key: 'BF-1377' }]),
            })),
          })),
        })),
      })),
      update: vi.fn(() => { throw new Error('an existing ticket must not be moved or rewritten'); }),
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => {
          inserted.push(value);
          return { returning: vi.fn().mockResolvedValue([{ id: 53 }]) };
        }),
      })),
    } as unknown as Db;
  }

  it('says when the chat link was refused instead of dropping it, and keeps the delta', async () => {
    mocks.linkTicket.mockResolvedValueOnce({ error: 'Chat not found' });
    const result = await new WorkDeltaService(existingTicketDb(), {} as never).record(1, 'user-1', {
      projectId: 11, chatId: 89, summary: 'Fix it', kind: 'fix',
    });
    expect(result).toMatchObject({ deltaId: 53, taskId: 1377, chatLink: { linked: false, chatId: 89, reason: 'Chat not found' } });
  });

  it('checks chat access as the identity the caller decided (a cloud agent in its host chat → null)', async () => {
    await new WorkDeltaService(existingTicketDb(), {} as never).record(1, 'agent-7', {
      projectId: 11, chatId: 89, summary: 'Fix it', kind: 'fix', chatAccessUserId: null,
    });
    expect(mocks.linkTicket).toHaveBeenCalledWith(1, 89, null, expect.objectContaining({ createdBy: 'agent-7' }));
  });

  /** A DB whose existing-ticket lookup finds nothing; records inserts and status writes. */
  function noTicketDb(inserted: Record<string, unknown>[] = [], updates: Record<string, unknown>[] = []): Db {
    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((value: Record<string, unknown>) => {
          updates.push(value);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => {
          inserted.push(value);
          return { returning: vi.fn().mockResolvedValue([{ id: 54 }]) };
        }),
      })),
    } as unknown as Db;
  }

  // regression: chats #273/#275 — the run's auto-capture minted "Code change from Brain chat
  // #273" before the session had changed anything; an empty ticket sat in_review on the board.
  it('refuses to mint a ticket for a delta that names no changed files, and writes nothing', async () => {
    const inserted: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    for (const files of [undefined, []]) {
      const result = await new WorkDeltaService(noTicketDb(inserted, updates), {} as never).record(1, 'user-1', {
        projectId: 11, chatId: 273, summary: 'Code change from Brain chat #273', kind: 'improvement', ...(files ? { files } : {}),
      });
      expect(result).toMatchObject({ ok: false, recorded: false, reason: 'no_changed_files' });
      expect((result as { error: string }).error).toMatch(/files/);
    }
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.linkTicket).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('mints the review-lane ticket once the delta names a changed file', async () => {
    mocks.createTask.mockResolvedValueOnce({ id: 6898, key: 'P-001' });
    const inserted: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const result = await new WorkDeltaService(noTicketDb(inserted, updates), {} as never).record(1, 'user-1', {
      projectId: 11, summary: 'Code change (1 file)', kind: 'improvement', files: ['src/a.ts'],
    });
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expect(updates[0]).toMatchObject({ status: 'in_review' });
    expect(inserted[0]).toMatchObject({ taskId: 6898, files: ['src/a.ts'] });
    expect(result).toMatchObject({ deltaId: 54, taskId: 6898, taskKey: 'P-001', deduped: false });
  });

  it('attaches a delta to the matching project ticket instead of creating a duplicate', async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([{ id: 1377, key: 'BF-1377' }]),
            })),
          })),
        })),
      })),
      update: vi.fn(() => {
        throw new Error('an existing ticket must not be moved or rewritten');
      }),
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => {
          inserted.push(value);
          return { returning: vi.fn().mockResolvedValue([{ id: 53 }]) };
        }),
      })),
    } as unknown as Db;

    const result = await new WorkDeltaService(db, {} as never).record(1, 'user-1', {
      projectId: 11,
      chatId: 89,
      summary: '  Fix   code block detection in brain-ui Markdown component  ',
      detail: 'The code change is complete.',
      files: ['packages/brain-ui/src/Markdown.tsx'],
      kind: 'fix',
      modality: 'ide',
    });

    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.linkTicket).toHaveBeenCalledWith(1, 89, 'user-1', {
      kind: 'task', ref: '1377', linkType: 'linked', createdBy: 'user-1',
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ projectId: 11, chatId: 89, taskId: 1377 });
    expect(result).toEqual({ deltaId: 53, kind: 'fix', taskId: 1377, taskKey: 'BF-1377', deduped: true, chatLink: { linked: true, chatId: 89, linkType: 'linked' } });
  });
});

// regression: VS Code chat #276 — deltas recorded while working epic #6902 minted standalone
// tickets, so the epic's progress ring stayed at 0% with two of its code changes done.
describe('WorkDeltaService parentTaskId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSegment.mockResolvedValue('00000000-0000-0000-0000-000000000001');
    mocks.resolveActorByRef.mockResolvedValue({ type: 'user', id: 'user-1' });
    mocks.recordActivity.mockResolvedValue(undefined);
    mocks.linkTicket.mockResolvedValue({});
  });

  /** A DB whose successive tenant+project ticket lookups answer from `lookups`, in order. */
  function lookupDb(
    lookups: Array<Array<{ id: number; key: string; status?: string }>>,
    inserted: Record<string, unknown>[] = [],
    updates: Record<string, unknown>[] = [],
  ): Db {
    const limit = vi.fn();
    for (const rows of lookups) limit.mockResolvedValueOnce(rows);
    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((value: Record<string, unknown>) => {
          updates.push(value);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => {
          inserted.push(value);
          return { returning: vi.fn().mockResolvedValue([{ id: 55 }]) };
        }),
      })),
    } as unknown as Db;
  }

  it('files a newly-minted ticket under a valid parent in the same project', async () => {
    mocks.createTask.mockResolvedValueOnce({ id: 6910, key: 'P-010' });
    // 1st lookup: no existing ticket for the summary; 2nd: the parent epic is active here.
    const result = await new WorkDeltaService(lookupDb([[], [{ id: 6902, key: 'P-002', status: 'in_progress' }]]), {} as never).record(1, 'user-1', {
      projectId: 11, summary: 'Measure slice A', kind: 'improvement', files: ['src/a.ts'], parentTaskId: 6902,
    });
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: 11, parentTaskId: 6902 }), 1);
    expect(result).toMatchObject({ taskId: 6910, deduped: false });
  });

  it('rejects a parent that is not an active ticket in the project (e.g. another project) and writes nothing', async () => {
    const inserted: Record<string, unknown>[] = [];
    await expect(new WorkDeltaService(lookupDb([[], []], inserted), {} as never).record(1, 'user-1', {
      projectId: 11, summary: 'Measure slice B', kind: 'improvement', files: ['src/b.ts'], parentTaskId: 777,
    })).rejects.toThrow('parentTaskId 777 is not an active ticket in project 11');
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('rejects a closed (done/cancelled) parent and writes nothing', async () => {
    for (const status of ['done', 'cancelled']) {
      const inserted: Record<string, unknown>[] = [];
      await expect(new WorkDeltaService(lookupDb([[], [{ id: 6902, key: 'P-002', status }]], inserted), {} as never).record(1, 'user-1', {
        projectId: 11, summary: 'Measure slice D', kind: 'improvement', files: ['src/e.ts'], parentTaskId: 6902,
      })).rejects.toThrow(`parentTaskId 6902 is closed (status ${status}) in project 11`);
      expect(inserted).toHaveLength(0);
    }
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('ignores parentTaskId when the delta attaches to an existing ticket (never re-parents)', async () => {
    const inserted: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const db = lookupDb([[{ id: 1377, key: 'BF-1377', status: 'in_progress' }]], inserted, updates);
    const result = await new WorkDeltaService(db, {} as never).record(1, 'user-1', {
      projectId: 11, taskId: 1377, summary: 'Fix it', kind: 'fix', files: ['src/c.ts'], parentTaskId: 777,
    });
    // No ticket is minted and nothing is written to the existing ticket — no parent anywhere.
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    // The delta lands on the existing ticket.
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ taskId: 1377 });
    expect(result).toMatchObject({ taskId: 1377, taskKey: 'BF-1377', deduped: true });
  });

  it('mints without a parent when parentTaskId is omitted (unchanged behaviour)', async () => {
    mocks.createTask.mockResolvedValueOnce({ id: 6911, key: 'P-011' });
    const db = lookupDb([[]]);
    await new WorkDeltaService(db, {} as never).record(1, 'user-1', {
      projectId: 11, summary: 'Measure slice C', kind: 'improvement', files: ['src/d.ts'],
    });
    expect(mocks.createTask.mock.calls[0]![0]).not.toHaveProperty('parentTaskId');
  });
});
