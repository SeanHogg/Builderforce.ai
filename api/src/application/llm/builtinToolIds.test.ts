/**
 * typed-entity-ids §5: the built-in tools read id ARGUMENTS through `idArg` (THE server-id parse),
 * keep `num()` for counts, and add `syncId` to the results that return a syncable entity.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const taskSvc = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  moveTask: vi.fn(),
}));
const chatTickets = vi.hoisted(() => ({ listTicketPageForChat: vi.fn() }));
const deltas = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock('../project/ProjectService', () => ({ ProjectService: function () { return {}; } }));
vi.mock('../task/TaskService', () => ({ TaskService: function () { return taskSvc; } }));
vi.mock('../../infrastructure/repositories/ProjectRepository', () => ({ ProjectRepository: function () { /* stub */ } }));
vi.mock('../../infrastructure/repositories/TaskRepository', () => ({ TaskRepository: function () { /* stub */ } }));
vi.mock('../brain/ChatTicketService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../brain/ChatTicketService')>()),
  ChatTicketService: function () { return chatTickets; },
}));
vi.mock('../delta/WorkDeltaService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../delta/WorkDeltaService')>()),
  WorkDeltaService: function () { return deltas; },
}));

import { callBuiltinTool } from './builtinMcpService';
import { idArg, syncIdField, withTicketSyncIds } from './builtinToolIds';

const db = {} as never;
const TENANT = 7;
const UUID = '0b5e4b0c-3f0c-4c55-9f5e-6d7c2a1b9e10';

beforeEach(() => vi.clearAllMocks());

describe('idArg', () => {
  it('accepts a positive integer or its decimal text', () => {
    expect(idArg(42, 'taskId')).toBe(42);
    expect(idArg('42', 'taskId')).toBe(42);
  });

  it.each([UUID, 'roadmap:abc', 'abc', '', '0', 0, -3, 1.5, null, undefined, '042'])('rejects %j with the argument named', (value) => {
    expect(() => idArg(value, 'taskId')).toThrow(/taskId must be a server id/);
  });

  it('syncIdField adds syncId only for an integer id', () => {
    expect(syncIdField(9)).toEqual({ syncId: 9 });
    expect(syncIdField(UUID)).toEqual({});
    expect(syncIdField(null)).toEqual({});
  });

  it('withTicketSyncIds adds syncId to task-table rows only, keeping every other field', () => {
    const rows = withTicketSyncIds([
      { kind: 'task', ref: '12', label: 'a' },
      { kind: 'epic', ref: '13', label: 'b' },
      { kind: 'gap', ref: '14', label: 'c' },
      { kind: 'roadmap', ref: UUID, label: 'd' },
      { kind: 'spec', ref: '15', label: 'e' },
    ]);
    expect(rows).toEqual([
      { kind: 'task', ref: '12', label: 'a', syncId: 12 },
      { kind: 'epic', ref: '13', label: 'b', syncId: 13 },
      { kind: 'gap', ref: '14', label: 'c', syncId: 14 },
      { kind: 'roadmap', ref: UUID, label: 'd' },
      { kind: 'spec', ref: '15', label: 'e' },
    ]);
  });
});

describe('built-in tools: id arguments and result ids', () => {
  it('fails a local (UUID) task id with a clear error instead of a NaN lookup', async () => {
    await expect(callBuiltinTool(db, { tenantId: TENANT, tool: 'tasks.delete', arguments: { id: UUID } }))
      .rejects.toThrow(/id must be a server id/);
    expect(taskSvc.getTask).not.toHaveBeenCalled();
    expect(taskSvc.deleteTask).not.toHaveBeenCalled();
  });

  it('tasks.create returns syncId beside id', async () => {
    taskSvc.listTasks.mockResolvedValue([]);
    taskSvc.createTask.mockResolvedValue({ toPlain: () => ({ id: 51, projectId: 3 }) });
    const res = await callBuiltinTool(db, { tenantId: TENANT, tool: 'tasks.create', arguments: { projectId: '3', title: 'T', assignedUserId: 'c-1' } });
    expect(res).toMatchObject({ id: 51, syncId: 51 });
    expect(taskSvc.createTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: 3 }), TENANT);
  });

  it('tickets.from_delta returns the ticket syncId', async () => {
    deltas.record.mockResolvedValue({ deltaId: 4, kind: 'fix', taskId: 77, taskKey: 'P-77', deduped: false });
    const res = await callBuiltinTool(db, { tenantId: TENANT, tool: 'tickets.from_delta', env: {} as never, arguments: { projectId: 3, summary: 'fixed it' } });
    expect(res).toMatchObject({ taskId: 77, syncId: 77 });
  });

  it('chats.list_tickets keeps offset 0 as a count and adds syncId to task-tier rows', async () => {
    chatTickets.listTicketPageForChat.mockResolvedValue({
      tickets: [{ kind: 'task', ref: '8' }, { kind: 'objective', ref: UUID }],
      total: 2, matched: 2, hasMore: false,
    });
    const res = await callBuiltinTool(db, { tenantId: TENANT, tool: 'chats.list_tickets', arguments: { chatId: '5', offset: 0, limit: 10 } });
    expect(chatTickets.listTicketPageForChat).toHaveBeenCalledWith(TENANT, 5, null, expect.objectContaining({ offset: 0, limit: 10 }));
    expect(res).toEqual({
      tickets: [{ kind: 'task', ref: '8', syncId: 8 }, { kind: 'objective', ref: UUID }],
      total: 2, matched: 2, hasMore: false,
    });
  });
});
