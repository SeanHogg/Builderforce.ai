import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { TicketParticipantsService } from './ticketParticipants';

function chain(rows: unknown[]) {
  const value: Record<string, unknown> = {};
  const self = () => value;
  value.from = self;
  value.innerJoin = self;
  value.where = self;
  value.limit = async () => rows;
  value.then = (resolve: (result: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return value;
}

function serviceWith(selectRows: unknown[][]) {
  let call = 0;
  const set = vi.fn(() => ({ where: vi.fn(async () => []) }));
  const db = {
    select: vi.fn(() => chain(selectRows[call++] ?? [])),
    update: vi.fn(() => ({ set })),
  } as unknown as Db;
  const service = new TicketParticipantsService(db);
  vi.spyOn(service as unknown as { bump: () => Promise<void> }, 'bump').mockResolvedValue();
  return { service, set };
}

type OwnerSync = {
  syncOwnerAssignee(env: Env, tenantId: number, taskId: number): Promise<void>;
};

describe('TicketParticipantsService owner synchronization', () => {
  it('resolves an active assigned agent into the explicit owner slot', async () => {
    const { service, set } = serviceWith([
      [{ assignedUserId: null, assignedAgentRef: 'ada' }],
      [{ name: 'Ada' }],
      [{ id: 'owner-slot', assigneeKind: null, assigneeRef: null, assigneeName: null }],
    ]);

    await (service as unknown as OwnerSync).syncOwnerAssignee({} as Env, 7, 709);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      assigneeKind: 'agent', assigneeRef: 'ada', assigneeName: 'Ada', state: 'assigned',
      signoffId: null, evidence: null,
    }));
  });

  it('returns an owner slot to unstaffed when the task has no assignee', async () => {
    const { service, set } = serviceWith([
      [{ assignedUserId: null, assignedAgentRef: null }],
      [{ id: 'owner-slot', assigneeKind: 'agent', assigneeRef: 'ada', assigneeName: 'Ada' }],
    ]);

    await (service as unknown as OwnerSync).syncOwnerAssignee({} as Env, 7, 709);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      assigneeKind: null, assigneeRef: null, assigneeName: null, state: 'unstaffed',
    }));
  });
});
