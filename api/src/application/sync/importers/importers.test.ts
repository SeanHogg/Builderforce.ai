import { describe, expect, it, vi } from 'vitest';
import { hashSyncPayload, type LocalEntityType } from '../../../domain/sync/syncProtocol';
import { boundKey, ctx, dbOf, event, mapping, stores } from './__fixtures__/importerHarness';
import { importMirrorRecord, mirrorRefuses } from './importMirrorRecord';
import { importSyncedProject } from './importSyncedProject';
import { importSyncedTicket } from './importSyncedTicket';
import { syncImporterFor } from './index';

describe('syncImporterFor', () => {
  it('names an owning importer or the mirror, and never a generic writer', () => {
    expect(syncImporterFor('ticket')).toBe('importSyncedTicket');
    expect(syncImporterFor('project')).toBe('importSyncedProject');
    expect(syncImporterFor('chat')).toBe('importSyncedChat');
    expect(syncImporterFor('message')).toBe('importSyncedMessage');
    expect(syncImporterFor('usage')).toBe('importSyncedUsage');
    expect(syncImporterFor('execution')).toBe('importMirrorRecord');
    expect(syncImporterFor('remediation')).toBe('importMirrorRecord');
    expect(syncImporterFor('widget')).toBeNull();
    expect(mirrorRefuses('ticket')).toBe(true);
    expect(mirrorRefuses('project')).toBe(true);
    expect(mirrorRefuses('remediation')).toBe(false);
    expect(mirrorRefuses('chat')).toBe(true);
  });
});

describe('importSyncedProject', () => {
  it('inserts a historical project row and returns applied mapping fields', async () => {
    const db = dbOf([[{ id: 9 }]]);
    const outcome = await importSyncedProject(
      event({ entityType: 'project', operation: 'create', payload: { name: '  Alpha  ', key: 'ALPHA' } }),
      ctx(),
      stores(),
      db,
    );
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.serverId).toBe('9');
    expect(outcome.serverVersion).toBe(1);
    expect(outcome.destinationKey).toBe(boundKey);
    expect(outcome.payload).toEqual({ name: 'Alpha', key: 'ALPHA', status: 'active' });
    expect(outcome.payloadHash).toBe(hashSyncPayload(outcome.payload));
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.kind).toBe('insert');
    expect(db.calls[0]?.payload).toMatchObject({
      tenantId: 7,
      key: 'ALPHA',
      name: 'Alpha',
      status: 'active',
      origin: 'imported',
    });
  });

  it('rejects an empty name and does not write', async () => {
    const db = dbOf();
    const outcome = await importSyncedProject(
      event({ entityType: 'project', operation: 'create', payload: { name: '   ' } }),
      ctx(),
      stores(),
      db,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'project_name_invalid' });
    expect(db.calls).toHaveLength(0);
  });

  it('replays an identical create without a second insert', async () => {
    const payload = { name: 'Alpha', key: 'ALPHA', status: 'active' };
    const db = dbOf();
    const outcome = await importSyncedProject(
      event({ entityType: 'project', operation: 'import', payload: { name: 'Alpha', key: 'ALPHA' } }),
      ctx(),
      stores(mapping({ payloadHash: hashSyncPayload(payload), serverVersion: 1 })),
      db,
    );
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.serverId).toBe('42');
    expect(outcome.serverVersion).toBe(1);
    expect(db.calls).toHaveLength(0);
  });

  it('conflicts when the same client id already maps to a different payload', async () => {
    const db = dbOf();
    const outcome = await importSyncedProject(
      event({ entityType: 'project', operation: 'create', payload: { name: 'Beta', key: 'BETA' } }),
      ctx(),
      stores(mapping()),
      db,
    );
    expect(outcome.status).toBe('conflict');
    if (outcome.status !== 'conflict') return;
    expect(outcome.detail).toBe('entity_already_imported');
    expect(outcome.serverId).toBe('42');
    expect(outcome.serverVersion).toBe(2);
    expect(db.calls).toHaveLength(0);
  });

  it('conflicts a stale update and does not write', async () => {
    const db = dbOf();
    const outcome = await importSyncedProject(
      event({
        entityType: 'project',
        operation: 'update',
        baseVersion: 1,
        payload: { name: 'Alpha', status: 'active' },
      }),
      ctx(),
      stores(mapping({ serverVersion: 4 })),
      db,
    );
    expect(outcome.status).toBe('conflict');
    if (outcome.status !== 'conflict') return;
    expect(outcome.detail).toBe('base_version_conflict');
    expect(outcome.serverVersion).toBe(4);
    expect(db.calls).toHaveLength(0);
  });

  it('updates the row and bumps the mapping version', async () => {
    const db = dbOf([[{ id: 42 }]]);
    const outcome = await importSyncedProject(
      event({
        entityType: 'project',
        operation: 'update',
        baseVersion: 2,
        payload: { name: 'Alpha', status: 'on_hold' },
      }),
      ctx(),
      stores(mapping()),
      db,
    );
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.serverVersion).toBe(3);
    expect(outcome.payload).toEqual({ name: 'Alpha', status: 'on_hold' });
    expect(db.calls[0]?.kind).toBe('update');
    expect(db.calls[0]?.payload).toMatchObject({ name: 'Alpha', status: 'on_hold' });
  });

  it('archives on delete instead of removing the row', async () => {
    const db = dbOf([[{ id: 42 }]]);
    const outcome = await importSyncedProject(
      event({ entityType: 'project', operation: 'delete', baseVersion: 2, payload: null }),
      ctx(),
      stores(mapping()),
      db,
    );
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.payload).toEqual({ status: 'archived' });
    expect(db.calls.map((call) => call.kind)).toEqual(['update']);
    expect(db.calls[0]?.payload).toMatchObject({ status: 'archived' });
  });

  it('translates a unique key collision into a rejection', async () => {
    const db = dbOf([Object.assign(new Error('duplicate key'), { code: '23505' })]);
    const outcome = await importSyncedProject(
      event({ entityType: 'project', operation: 'create', payload: { name: 'Alpha', key: 'ALPHA' } }),
      ctx(),
      stores(),
      db,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'project_key_conflict' });
  });

  it('refuses a ticket mutation', async () => {
    const db = dbOf();
    const outcome = await importSyncedProject(
      event({ entityType: 'ticket', operation: 'create', payload: { title: 'Nope' } }),
      ctx(),
      stores(),
      db,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'entity_type_rejected' });
    expect(db.calls).toHaveLength(0);
  });
});

describe('importSyncedTicket', () => {
  const payload = {
    projectId: 'proj-client',
    title: '  Historical bug  ',
    status: 'rejected',
    priority: 'low',
    assignedUserId: 'user-9',
    assignedAgentRef: 'agent-should-not-land',
    dispatch: true,
  };

  it('inserts a client-reported task and ignores agent-dispatch fields', async () => {
    const db = dbOf([[{ id: 15 }]]);
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload }),
      ctx(),
      stores(),
      db,
    );
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.serverId).toBe('15');
    expect(outcome.serverVersion).toBe(1);
    expect(outcome.payload).toMatchObject({
      projectId: '3',
      title: 'Historical bug',
      status: 'rejected',
      priority: 'low',
      assignedUserId: 'user-9',
      archived: false,
    });
    expect(outcome.payload).not.toHaveProperty('assignedAgentRef');
    expect(outcome.payload).not.toHaveProperty('dispatch');
    expect(outcome.payloadHash).toBe(hashSyncPayload(outcome.payload));
    const row = db.calls[0]?.payload as Record<string, unknown>;
    expect(db.calls[0]?.kind).toBe('insert');
    expect(row).toMatchObject({
      projectId: 3,
      tenantId: 7,
      title: 'Historical bug',
      status: 'rejected',
      priority: 'low',
      source: 'client-reported',
      taskType: 'task',
      assignedUserId: 'user-9',
    });
    expect(row).not.toHaveProperty('assignedAgentRef');
    expect(row).not.toHaveProperty('assignedAgentType');
    expect(row).not.toHaveProperty('assignedAgentHostId');
    expect(String(row.key)).toMatch(/^SYNC-/);
  });

  it('rejects when the project reference does not resolve', async () => {
    const db = dbOf();
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload }),
      ctx({ resolveProjectId: async () => null }),
      stores(),
      db,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'project_unresolved' });
    expect(db.calls).toHaveLength(0);
  });

  it('holds a young event whose project/parent is a well-formed UUID with no mapping yet, rejects it once old', async () => {
    const UUID = '33333333-3333-4333-8333-333333333333';
    const young = '2026-10-17T23:58:00.000Z';
    const noProject = ctx({ resolveProjectId: async () => null });
    const heldProject = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', occurredAt: young, payload: { ...payload, projectId: UUID } }),
      noProject, stores(), dbOf(),
    );
    expect(heldProject).toEqual({ status: 'pending', detail: 'project_pending' });
    const oldProject = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload: { ...payload, projectId: UUID } }),
      noProject, stores(), dbOf(),
    );
    expect(oldProject).toEqual({ status: 'rejected', detail: 'project_unresolved' });
    const heldParent = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', occurredAt: young, payload: { ...payload, parentTicketId: UUID } }),
      ctx({ resolveTaskId: async () => null }), stores(), dbOf(),
    );
    expect(heldParent).toEqual({ status: 'pending', detail: 'parent_ticket_pending' });
    const decimalParent = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', occurredAt: young, payload: { ...payload, parentTicketId: '999' } }),
      ctx({ resolveTaskId: async () => null }), stores(), dbOf(),
    );
    expect(decimalParent).toEqual({ status: 'rejected', detail: 'parent_ticket_unresolved' });
  });

  it('rejects when a parent ticket reference does not resolve', async () => {
    const db = dbOf();
    const outcome = await importSyncedTicket(
      event({
        entityType: 'ticket',
        operation: 'create',
        payload: { ...payload, parentTicketId: 'parent-client' },
      }),
      ctx({ resolveTaskId: async () => null }),
      stores(),
      db,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'parent_ticket_unresolved' });
    expect(db.calls).toHaveLength(0);
  });

  it('rejects a bad priority', async () => {
    const db = dbOf();
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload: { ...payload, priority: 'now' } }),
      ctx(),
      stores(),
      db,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'ticket_priority_invalid' });
  });

  it('conflicts a stale update', async () => {
    const db = dbOf();
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'update', baseVersion: 1, payload }),
      ctx(),
      stores(mapping({ serverVersion: 5 })),
      db,
    );
    expect(outcome.status).toBe('conflict');
    if (outcome.status !== 'conflict') return;
    expect(outcome.detail).toBe('base_version_conflict');
    expect(db.calls).toHaveLength(0);
  });

  it('archives on delete and does not delete the row', async () => {
    const db = dbOf([[{ id: 42 }]]);
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'delete', baseVersion: 2, payload: null }),
      ctx(),
      stores(mapping()),
      db,
    );
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.payload).toEqual({ archived: true });
    expect(db.calls.map((call) => call.kind)).toEqual(['update']);
    expect(db.calls[0]?.payload).toMatchObject({ archived: true });
  });

  it('rejects an assignee who is not an active member of the tenant, before any write', async () => {
    const db = dbOf();
    const asked: string[] = [];
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload }),
      ctx({ isTenantMember: async (userId) => { asked.push(userId); return false; } }),
      stores(),
      db,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'ticket_assignee_invalid' });
    expect(asked).toEqual(['user-9']);
    expect(db.calls).toHaveLength(0);
  });

  it('writes the task inside a savepoint of the unit-of-work transaction', async () => {
    const db = dbOf([[{ id: 15 }]]);
    await importSyncedTicket(event({ entityType: 'ticket', operation: 'create', payload }), ctx(), stores(), db);
    expect(db.savepoints()).toBe(1);
  });

  it('applies a delete over a stale base — a tombstone wins under the conflict policy', async () => {
    const db = dbOf([[{ id: 42 }]]);
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'delete', baseVersion: 1, payload: null }),
      ctx(),
      stores(mapping({ serverVersion: 5 })),
      db,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverVersion: 6, payload: { archived: true } });
  });

  it('refuses an update that would resurrect a deleted ticket', async () => {
    const db = dbOf();
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'update', baseVersion: 3, payload }),
      ctx(),
      stores(mapping({ serverVersion: 3, deletedAt: new Date('2026-01-02T00:00:00.000Z') })),
      db,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'entity_deleted' });
    expect(db.calls).toHaveLength(0);
  });

  it('acknowledges a repeat delete without a second write or version bump', async () => {
    const db = dbOf();
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'delete', baseVersion: 1, payload: null }),
      ctx(),
      stores(mapping({ serverVersion: 3, deletedAt: new Date('2026-01-02T00:00:00.000Z') })),
      db,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverVersion: 3, payload: { archived: true } });
    expect(db.calls).toHaveLength(0);
  });

  it('does not write sync tables', async () => {
    const db = dbOf([[{ id: 15 }]]);
    const book = stores();
    await importSyncedTicket(event({ entityType: 'ticket', operation: 'create', payload }), ctx(), book, db);
    expect(book.writes).toEqual([]);
  });
});

describe('importSyncedTicket — task type and the chat it was created in', () => {
  const CHAT = '22222222-2222-4222-8222-222222222222';
  const base = { projectId: '9', title: 'Phase 1', status: 'backlog' };
  /** No ticket mapping yet; the chat maps to server chat 55 when `chatMapped`. */
  const book = (chatMapped: boolean) => ({
    ...stores(),
    findMapping: async (_tenant: number, type: string) => (type === 'chat' && chatMapped ? mapping({ serverId: '55' }) : null),
  });

  it('writes the epic task type and links the chat as created, in the same savepoint', async () => {
    const db = dbOf([[{ id: 15 }], [], [{ id: 1 }]]);
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload: { ...base, taskType: 'epic', chatClientId: CHAT } }),
      ctx(),
      book(true),
      db,
    );
    expect(outcome.status).toBe('applied');
    expect(db.calls.map((call) => call.kind)).toEqual(['insert', 'select', 'insert']);
    expect(db.calls[0]?.payload).toMatchObject({ taskType: 'epic' });
    expect(db.calls[2]?.payload).toMatchObject({
      tenantId: 7,
      chatId: 55,
      ticketKind: 'epic',
      ticketRef: '15',
      linkType: 'created',
      createdBy: 'user-1',
    });
    if (outcome.status === 'applied') expect(outcome.payload).toMatchObject({ taskType: 'epic', chatClientId: CHAT });
  });

  it('defaults to a plain task with no link and keeps its canonical form unchanged', async () => {
    const db = dbOf([[{ id: 16 }]]);
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload: base }),
      ctx(),
      stores(),
      db,
    );
    expect(db.calls.map((call) => call.kind)).toEqual(['insert']);
    expect(db.calls[0]?.payload).toMatchObject({ taskType: 'task' });
    expect(outcome.status === 'applied' && outcome.payload).not.toHaveProperty('taskType');
  });

  it('does not link a second time when the same ticket is pushed again', async () => {
    const payload = { ...base, taskType: 'epic', chatClientId: CHAT };
    const first = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload }),
      ctx(),
      book(true),
      dbOf([[{ id: 15 }], [], [{ id: 1 }]]),
    );
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    // The replay may READ whether the link exists (it does) and must not write.
    const replay = dbOf([[{ id: 1 }]]);
    const again = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload }),
      ctx(),
      stores(mapping({ serverId: '15', serverVersion: 1, payloadHash: first.payloadHash })),
      replay,
    );
    expect(again.status).toBe('applied');
    expect(replay.calls.map((call) => call.kind)).toEqual(['select']);
  });

  const YOUNG = '2026-10-17T23:58:00.000Z';

  it('holds a YOUNG event as dependency_pending while the chat is unmapped, writing nothing', async () => {
    const db = dbOf();
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', occurredAt: YOUNG, payload: { ...base, chatClientId: CHAT } }),
      ctx(),
      book(false),
      db,
    );
    expect(outcome).toEqual({ status: 'pending', detail: 'ticket_chat_pending' });
    expect(db.calls).toHaveLength(0);
  });

  it('imports an OLD event without the link when its chat never mapped (no pending forever)', async () => {
    const db = dbOf([[{ id: 17 }]]);
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload: { ...base, chatClientId: CHAT } }),
      ctx(),
      book(false),
      db,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverId: '17', detail: 'ticket_chat_link_skipped_unmapped' });
    expect(db.calls.map((call) => call.kind)).toEqual(['insert']);
  });

  it('imports the ticket WITHOUT the link when the chat is not the callers own, and says why', async () => {
    const db = dbOf([[{ id: 18 }]]);
    const afterCommit = vi.fn();
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload: { ...base, chatClientId: CHAT } }),
      ctx({ resolveOwnChatId: async () => null, afterCommit }),
      book(true),
      db,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverId: '18', detail: 'ticket_chat_link_skipped_not_owned' });
    expect(db.calls.map((call) => call.kind)).toEqual(['insert']);
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it('defers the cache bump to after commit instead of running it inside the unit of work', async () => {
    const afterCommit = vi.fn();
    await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload: { ...base, chatClientId: CHAT } }),
      ctx({ afterCommit }),
      book(true),
      dbOf([[{ id: 19 }], [], [{ id: 1 }]]),
    );
    expect(afterCommit).toHaveBeenCalledTimes(1);
  });

  it('a retry after the chat maps adds the missing link to the existing ticket without a second ticket', async () => {
    const payload = { ...base, chatClientId: CHAT };
    const first = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload }),
      ctx(),
      book(false),
      dbOf([[{ id: 20 }]]),
    );
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    const retry = dbOf([[], [], [{ id: 2 }]]);
    const afterCommit = vi.fn();
    const again = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload }),
      ctx({ afterCommit }),
      {
        ...stores(),
        findMapping: async (_t: number, type: string) => (
          type === 'chat' ? mapping({ serverId: '55' }) : mapping({ serverId: '20', serverVersion: 1, payloadHash: first.payloadHash })
        ),
      },
      retry,
    );
    expect(again).toMatchObject({ status: 'applied', serverId: '20' });
    // select (existing link?) then insert of the link; never an insert into tasks first.
    expect(retry.calls.map((call) => call.kind)).toEqual(['select', 'select', 'insert']);
    expect(retry.calls[2]?.payload).toMatchObject({ chatId: 55, ticketRef: '20', linkType: 'created' });
    expect(afterCommit).toHaveBeenCalledTimes(1);
  });

  it('keeps the ticket and reports ticket_chat_link_failed when only the link write fails', async () => {
    const afterCommit = vi.fn();
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload: { ...base, chatClientId: CHAT } }),
      ctx({ afterCommit }),
      book(true),
      dbOf([[{ id: 30 }], new Error('link write failed')]),
    );
    expect(outcome).toMatchObject({ status: 'applied', serverId: '30', detail: 'ticket_chat_link_failed' });
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it('an update writes the task type and moves the ticket\'s chat links onto the new kind', async () => {
    const afterCommit = vi.fn();
    const db = dbOf([[{ id: 42 }], [{ chatId: 55 }]]);
    const outcome = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'update', baseVersion: 2, payload: { ...base, taskType: 'epic' } }),
      ctx({ afterCommit }),
      stores(mapping({ serverVersion: 2 })),
      db,
    );
    expect(outcome.status).toBe('applied');
    expect(db.calls.map((call) => call.kind)).toEqual(['update', 'update']);
    expect(db.calls[0]?.payload).toMatchObject({ taskType: 'epic' });
    expect(db.calls[1]?.payload).toMatchObject({ ticketKind: 'epic' });
    expect(afterCommit).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown task type and a malformed chat id', async () => {
    const type = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload: { ...base, taskType: 'portfolio' } }),
      ctx(),
      stores(),
      dbOf(),
    );
    expect(type).toEqual({ status: 'rejected', detail: 'ticket_task_type_invalid' });
    const badChat = await importSyncedTicket(
      event({ entityType: 'ticket', operation: 'create', payload: { ...base, chatClientId: 'not-a-uuid' } }),
      ctx(),
      stores(),
      dbOf(),
    );
    expect(badChat).toEqual({ status: 'rejected', detail: 'ticket_chat_invalid' });
  });
});

describe('importMirrorRecord', () => {
  it('refuses ticket and project before any mapping read', async () => {
    const book = stores();
    book.findMapping = async () => {
      throw new Error('mirror must not read a ticket mapping');
    };
    const ticket = await importMirrorRecord(
      event({ entityType: 'ticket', operation: 'create', payload: { title: 'no' } }),
      ctx(),
      book,
    );
    const project = await importMirrorRecord(
      event({ entityType: 'project', operation: 'create', payload: { name: 'no' } }),
      ctx(),
      book,
    );
    expect(ticket).toEqual({ status: 'rejected', detail: 'entity_type_rejected' });
    expect(project).toEqual({ status: 'rejected', detail: 'entity_type_rejected' });
    expect(book.writes).toEqual([]);
  });

  it('accepts a remediation as history and does not mint a server aggregate', async () => {
    const payload = { summary: 'old finding', openedTicket: false };
    const book = stores();
    const outcome = await importMirrorRecord(
      event({ entityType: 'remediation', operation: 'import', payload }),
      ctx(),
      book,
    );
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.serverId).toBe('11111111-1111-4111-8111-111111111111');
    expect(outcome.serverVersion).toBe(1);
    expect(outcome.payload).toEqual(payload);
    expect(outcome.payloadHash).toBe(hashSyncPayload(payload));
    expect(outcome.destinationKey).toBe(boundKey);
    expect(book.writes).toEqual([]);
  });

  it('conflicts a divergent history replay', async () => {
    const outcome = await importMirrorRecord(
      // Chat has its own importer since PRD 36.4; execution is still history-only.
      event({ entityType: 'execution', operation: 'create', payload: { title: 'later' } }),
      ctx(),
      stores(mapping({ serverId: 'chat-1', serverVersion: 3 })),
    );
    expect(outcome.status).toBe('conflict');
    if (outcome.status !== 'conflict') return;
    expect(outcome.detail).toBe('entity_already_imported');
    expect(outcome.serverId).toBe('chat-1');
    expect(outcome.serverVersion).toBe(3);
  });

  it('rejects an unknown entity type', async () => {
    const outcome = await importMirrorRecord(
      event({ entityType: 'ticket', operation: 'create', payload: {} }),
      ctx(),
      stores(),
    );
    expect(outcome.status).toBe('rejected');
    const unknown = await importMirrorRecord(
      {
        ...event({ entityType: 'chat', operation: 'create', payload: {} }),
        entityType: 'widget' as LocalEntityType,
      },
      ctx(),
      stores(),
    );
    expect(unknown).toEqual({ status: 'rejected', detail: 'entity_type_rejected' });
  });
});
