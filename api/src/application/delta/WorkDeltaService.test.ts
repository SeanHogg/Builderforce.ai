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
    expect(result).toEqual({ deltaId: 53, kind: 'fix', taskId: 1377, taskKey: 'BF-1377', deduped: true });
  });
});
