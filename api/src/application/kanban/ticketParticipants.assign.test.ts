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
  value.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return value;
}

function dbForAgent() {
  let selectCall = 0;
  const set = vi.fn();
  const returning = vi.fn(async () => [{
    id: 'slot-1', tenantId: 7, taskId: 793, stageKey: 'in_progress', roleKey: 'engineer',
    responsibility: 'owner', required: true, source: 'template', assigneeKind: 'agent',
    assigneeRef: 'john', assigneeName: 'John Coder', state: 'assigned', signoffId: null,
    childTaskId: null, evidence: null, quorumGroup: null, note: null,
    createdAt: new Date(), updatedAt: new Date(),
  }]);
  const where = vi.fn(() => ({ returning }));
  set.mockReturnValue({ where });
  const db = {
    select: vi.fn(() => chain([
      [{ id: 793 }],
      [{ id: 'slot-1' }],
      [{ name: 'John Coder' }],
    ][selectCall++] ?? [])),
    update: vi.fn(() => ({ set })),
  };
  return { db: db as unknown as Db, set };
}

describe('TicketParticipantsService.assignParticipant', () => {
  it('reassigns an existing role and resets it to assigned with fresh evidence required', async () => {
    const { db, set } = dbForAgent();
    const service = new TicketParticipantsService(db);
    vi.spyOn(service as unknown as { bump: () => Promise<void> }, 'bump').mockResolvedValue();

    const result = await service.assignParticipant({} as Env, 7, 793, {
      roleKey: ' engineer ', assigneeRef: ' john ', assigneeKind: 'agent',
    });

    expect(result.updated).toBe(1);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      assigneeKind: 'agent', assigneeRef: 'john', assigneeName: 'John Coder',
      state: 'assigned', signoffId: null, evidence: null,
    }));
  });

  it('rejects an unsupported assignee kind before touching the database', async () => {
    const { db } = dbForAgent();
    const service = new TicketParticipantsService(db);
    await expect(service.assignParticipant({} as Env, 7, 793, {
      roleKey: 'engineer', assigneeRef: 'john', assigneeKind: 'hire' as 'agent',
    })).rejects.toThrow('assigneeKind must be "agent" or "user"');
  });
});
