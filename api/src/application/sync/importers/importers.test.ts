import { describe, expect, it } from 'vitest';
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
