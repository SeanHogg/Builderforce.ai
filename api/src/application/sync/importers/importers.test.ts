import { describe, expect, it } from 'vitest';
import { destinationKey, hashSyncPayload, type LocalEntityType } from '../../../domain/sync/syncProtocol';
import type { Db } from '../../../infrastructure/database/connection';
import { fakeDb } from '../../../../test/fakeDb';
import type { SyncEntityMappingRow, SyncEventInput, SyncImportContext, SyncStoreSet } from '../syncPorts';
import { importMirrorRecord, mirrorRefuses } from './importMirrorRecord';
import { importSyncedProject } from './importSyncedProject';
import { importSyncedTicket } from './importSyncedTicket';
import { importEntity as importProjectEntity, kind as projectKind } from './projectImporter';
import { importEntity as importTicketEntity, kind as ticketKind } from './ticketImporter';
import { syncImporterFor } from './index';

const destination = { kind: 'bound' as const, tenantId: '7', accountId: 'user-1' };
const boundKey = destinationKey(destination);
const now = new Date('2026-10-18T00:00:00.000Z');

function ctx(overrides: Partial<SyncImportContext> = {}): SyncImportContext {
  return {
    auth: { tenantId: 7, userId: 'user-1', role: 'member' },
    deviceId: 'device-1',
    destination,
    destinationKey: boundKey,
    now,
    resolveProjectId: async () => 3,
    resolveTaskId: async () => null,
    ...overrides,
  };
}

function event(partial: {
  entityType: LocalEntityType;
  operation: SyncEventInput['operation'];
  payload: unknown;
  clientEntityId?: string;
  baseVersion?: number;
  schemaVersion?: number;
}): SyncEventInput {
  return {
    eventId: 'evt-1',
    clientEntityId: partial.clientEntityId ?? '11111111-1111-4111-8111-111111111111',
    entityType: partial.entityType,
    operation: partial.operation,
    schemaVersion: partial.schemaVersion ?? 1,
    localSequence: 1,
    occurredAt: '2026-01-01T00:00:00.000Z',
    baseVersion: partial.baseVersion,
    dependsOn: [],
    destination,
    payload: partial.payload,
    payloadHash: hashSyncPayload(partial.payload),
  };
}

function stores(mapping: SyncEntityMappingRow | null = null): SyncStoreSet & { writes: string[] } {
  const writes: string[] = [];
  const forbid = (name: string) => async () => {
    writes.push(name);
    throw new Error(`importer must not ${name}`);
  };
  return {
    writes,
    findEvent: async () => null,
    insertEvent: forbid('insertEvent'),
    acceptedEventIds: async () => new Set(),
    findMapping: async () => mapping,
    upsertMapping: forbid('upsertMapping'),
    upsertRecord: forbid('upsertRecord'),
    appendChange: forbid('appendChange'),
  };
}

function mapping(partial: Partial<SyncEntityMappingRow> = {}): SyncEntityMappingRow {
  return {
    serverId: '42',
    serverVersion: 2,
    payloadHash: 'fnv1a:00000000',
    destinationKey: boundKey,
    ...partial,
  };
}

function dbOf(results: Array<unknown[] | Error> = []) {
  return fakeDb(results) as unknown as Db & { calls: ReturnType<typeof fakeDb>['calls'] };
}

describe('syncImporterFor', () => {
  it('names an owning importer or the mirror, and never a generic writer', () => {
    expect(syncImporterFor('ticket')).toBe('importSyncedTicket');
    expect(syncImporterFor('project')).toBe('importSyncedProject');
    expect(syncImporterFor('chat')).toBe('importMirrorRecord');
    expect(syncImporterFor('remediation')).toBe('importMirrorRecord');
    expect(syncImporterFor('widget')).toBeNull();
    expect(mirrorRefuses('ticket')).toBe(true);
    expect(mirrorRefuses('project')).toBe(true);
    expect(mirrorRefuses('remediation')).toBe(false);
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
      event({ entityType: 'chat', operation: 'create', payload: { title: 'later' } }),
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

function thrownCode(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
}

describe('bounded kind importers', () => {
  const bound = { kind: 'bound' as const, tenantId: '7', accountId: 'user-1' };
  const ticketEvent = {
    entityType: 'ticket' as const,
    destination: bound,
    clientEntityId: '11111111-1111-4111-8111-111111111111',
  };
  const projectEvent = {
    entityType: 'project' as const,
    destination: bound,
    clientEntityId: '22222222-2222-4222-8222-222222222222',
  };

  it('exports one kind and accepts only that kind, with no writer callback', () => {
    expect(ticketKind).toBe('ticket');
    expect(projectKind).toBe('project');
    expect(importTicketEntity).toHaveLength(1);
    expect(importProjectEntity).toHaveLength(1);
    expect(importTicketEntity(ticketEvent)).toEqual({
      kind: 'ticket',
      clientEntityId: ticketEvent.clientEntityId,
    });
    expect(importProjectEntity(projectEvent)).toEqual({
      kind: 'project',
      clientEntityId: projectEvent.clientEntityId,
    });
  });

  it('refuses a ticket event on the project importer', () => {
    expect(thrownCode(() => importProjectEntity(ticketEvent))).toBe('wrong_kind');
    expect(thrownCode(() => importProjectEntity({ ...ticketEvent, destination: { kind: 'unbound' } }))).toBe('wrong_kind');
  });

  it('throws wrong_kind when the kind is missing or foreign', () => {
    expect(thrownCode(() => importTicketEntity({ destination: bound }))).toBe('wrong_kind');
    expect(thrownCode(() => importTicketEntity(undefined))).toBe('wrong_kind');
    expect(thrownCode(() => importProjectEntity({ destination: bound }))).toBe('wrong_kind');
    expect(thrownCode(() => importTicketEntity({ entityType: 'chat', destination: bound }))).toBe('wrong_kind');
    expect(thrownCode(() => importProjectEntity({ entityType: 'chat', destination: bound }))).toBe('wrong_kind');
    expect(thrownCode(() => importTicketEntity(projectEvent))).toBe('wrong_kind');
  });

  it('refuses an unbound destination', () => {
    expect(thrownCode(() => importTicketEntity({ ...ticketEvent, destination: { kind: 'unbound' } }))).toBe('unbound_destination');
    expect(thrownCode(() => importTicketEntity({ entityType: 'ticket' }))).toBe('unbound_destination');
    expect(thrownCode(() => importProjectEntity({ ...projectEvent, destination: null }))).toBe('unbound_destination');
    expect(thrownCode(() => importProjectEntity({ entityType: 'project', destination: { kind: 'unbound' } }))).toBe('unbound_destination');
  });
});
