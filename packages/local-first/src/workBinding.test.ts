/**
 * The work slice of sync on enable: projects and tickets the editor's agent filed locally
 * (unbound) are handed to the account as one import each, ordered so the server's
 * `dependency_pending` hold is brief (project → parent ticket → ticket, after the chat).
 */

import { describe, expect, it, vi } from 'vitest';
import { UNBOUND_DESTINATION } from './records.js';
import type { EntityDestination, ProjectValue, TicketValue } from './records.js';
import { createMemoryLocalFirstStore, newLocalRecord, type LocalFirstStore } from './store.js';
import { importKey, queueImport } from './journalRules.js';
import { bindWorkForSync } from './workBinding.js';
import { RECORD_PAYLOAD_FENCE_KEY, isRecordPayloadFence } from './recordPayloadMarker.js';
import { sendablePayload } from './syncRound.js';
import type { JournalEvent } from './records.js';

/** The queued work (not the partition's record-payload fence, which only holds older builds off markers). */
const work = (events: readonly JournalEvent[]): JournalEvent[] => events.filter((event) => !isRecordPayloadFence(event));
/** What an event waits on, the fence aside. */
const dependsOn = (event: JournalEvent): string[] => event.dependsOn.filter((dependency) => dependency !== RECORD_PAYLOAD_FENCE_KEY);

const ACCOUNT: EntityDestination = { kind: 'bound', platformInstance: 'https://builderforce.ai', tenantId: '7' };
const DEVICE = 'device-1';
const PROJECT = '00000000-0000-4000-8000-0000000000a1';
const EPIC = '00000000-0000-4000-8000-0000000000b1';
const TASK = '00000000-0000-4000-8000-0000000000b2';

/** What the editor's local repository writes: the record plus its create event, unbound. */
async function file(store: LocalFirstStore, entityType: 'project' | 'ticket', id: string, payload: ProjectValue | TicketValue, at: number) {
  await store.transact(async (tx) => {
    const record = newLocalRecord<ProjectValue | TicketValue>({
      id,
      entityType,
      payload,
      deviceId: DEVICE,
      destination: UNBOUND_DESTINATION,
      occurredAt: new Date(Date.UTC(2026, 10, 7, 0, 0, at)).toISOString(),
    });
    await tx.put(record);
    await tx.append({
      eventId: `${entityType}:${id}:v1`,
      clientEntityId: id,
      entityType,
      operation: 'create',
      schemaVersion: record.schemaVersion,
      occurredAt: record.occurredAt,
      dependsOn: [],
      destination: record.destination,
      payload,
    });
  });
}

describe('bindWorkForSync', () => {
  it('rebinds an unbound ticket and queues its import waiting on its project, its parent and its chat', async () => {
    const store = createMemoryLocalFirstStore();
    // The chat's own import is queued first by the chat slice of the same sync pass.
    const chatClientId = '00000000-0000-4000-8000-0000000000c1';
    await store.transact(async (tx) => {
      const chat = newLocalRecord<unknown>({
        id: chatClientId, entityType: 'chat', payload: { clientId: chatClientId, chat: { title: 'Program' } },
        deviceId: DEVICE, destination: ACCOUNT, occurredAt: '2026-11-07T00:00:00.000Z',
      });
      await tx.put(chat);
      await queueImport(tx, chat);
    });
    await file(store, 'project', PROJECT, { name: 'Board' }, 1);
    // Filed child-first on purpose: the parent must still be queued first.
    await file(store, 'ticket', TASK, { projectId: PROJECT, title: 'Task', status: 'backlog', parentTicketId: EPIC, chatClientId }, 3);
    await file(store, 'ticket', EPIC, { projectId: PROJECT, title: 'Epic', status: 'backlog', taskType: 'epic', chatClientId }, 2);

    expect(await bindWorkForSync(store, DEVICE, ACCOUNT)).toBe(3);

    const pending = work(await store.read((tx) => tx.pending()));
    expect(pending.every((event) => event.destination.kind === 'bound' && event.operation === 'import')).toBe(true);
    const byId = new Map(pending.map((event) => [event.clientEntityId, event]));
    const chatImport = pending.find((event) => event.entityType === 'chat')!;
    const project = byId.get(PROJECT)!;
    const epic = byId.get(EPIC)!;
    const task = byId.get(TASK)!;
    expect(dependsOn(project)).toEqual([]);
    expect(dependsOn(epic)).toEqual([chatImport.idempotencyKey, project.idempotencyKey]);
    expect(dependsOn(task)).toEqual([chatImport.idempotencyKey, project.idempotencyKey, epic.idempotencyKey]);
    // The import carries the ticket's current state — read from the record when it is sent —
    // including what sync turns into the chat link.
    expect(await store.read((tx) => sendablePayload(tx, epic))).toMatchObject({ taskType: 'epic', chatClientId });
    // Queue order is dependency order: project, then the parent, then its child.
    const order = pending.filter((event) => event.entityType !== 'chat').map((event) => event.clientEntityId);
    expect(order).toEqual([PROJECT, EPIC, TASK]);
  });

  it('waits on nothing local for a server project / parent reference, and leaves a bound row alone', async () => {
    const store = createMemoryLocalFirstStore();
    await file(store, 'ticket', TASK, { projectId: '11', title: 'On server project 11', status: 'backlog', parentTicketId: '42' }, 1);
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord<ProjectValue>({
        id: PROJECT, entityType: 'project', payload: { name: 'Already bound' }, deviceId: DEVICE, destination: ACCOUNT,
        occurredAt: '2026-11-07T00:00:00.000Z',
      }));
    });
    expect(await bindWorkForSync(store, DEVICE, ACCOUNT)).toBe(1);
    const pending = work(await store.read((tx) => tx.pending()));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ entityType: 'ticket', operation: 'import' });
    expect(dependsOn(pending[0]!)).toEqual([]);
    expect(importKey('ticket', TASK)).toBe(pending[0]!.idempotencyKey);
  });

  it('is idempotent: a second pass finds nothing and writes nothing', async () => {
    const store = createMemoryLocalFirstStore();
    await file(store, 'project', PROJECT, { name: 'Board' }, 1);
    expect(await bindWorkForSync(store, DEVICE, ACCOUNT)).toBe(1);
    const notified = vi.fn();
    store.subscribe(notified);
    expect(await bindWorkForSync(store, DEVICE, ACCOUNT)).toBe(0);
    expect(notified).not.toHaveBeenCalled();
  });

  it('does nothing without a bound destination', async () => {
    const store = createMemoryLocalFirstStore();
    await file(store, 'project', PROJECT, { name: 'Board' }, 1);
    expect(await bindWorkForSync(store, DEVICE, UNBOUND_DESTINATION)).toBe(0);
    expect((await store.read((tx) => tx.pending()))[0]?.destination.kind).toBe('unbound');
  });
});
