/**
 * G10: every local create path stores an explicit destination, and an unbound
 * record is refused at sync until a destination is chosen.
 *
 * The create paths are the real ones — `createLocalWork`, the transactional
 * commit, the host chat log, an audit finding, and a memory fact — not a
 * helper standing in for them. Each is driven with a destination omitted, so
 * the assertion is about what the path STORES, not about what a caller passed.
 *
 * The sync half uses the real coordinator. An unbound record's events sit in
 * the unbound partition, which `synchronize` cannot name, so the coordinator's
 * `refuseUnbound` is what a caller reaches instead: it returns a refusal per
 * event and sends nothing. After `chooseDestination` moves the record and its
 * events together, the same coordinator pushes them and the refusal is empty.
 */

import { describe, expect, it } from 'vitest';
import { createHostChatLog } from './hostChatRecord.js';
import { createLocalAuditFinding } from './localAudit.js';
import { createLocalWork } from './localWork.js';
import { createTransactionalRecordStore } from './transactionalRecord.js';
import { createFactStore } from './factProvenance.js';
import { createMemoryLocalFirstStore } from './store.js';
import { createSyncCoordinator, type SyncPushBatch, type SyncTransport } from './sync.js';
import { createPlatformPolicy } from './policy.js';
import { createDeviceStoreCoordinatorLease } from './syncLease.js';
import {
  GATED_CREATE_ENTITY_TYPES,
  LOCAL_CREATE_PATHS,
  SYNC_DESTINATION_REQUIRED,
  UNBOUND_DESTINATION_CODE,
  chooseDestination,
  hasExplicitDestination,
  isUnboundDestination,
  partitionUnboundPending,
  requireBoundCreateDestination,
  resolveCreateDestination,
  unboundEventRefusal,
  unboundRecordRefusal,
} from './creationDestination.js';
import { UNBOUND_DESTINATION, type EntityDestination, type LocalEntityType } from './records.js';

const DEVICE = 'device-1';
const AT = '2026-10-18T12:00:00.000Z';

const BOUND: EntityDestination = Object.freeze({
  kind: 'bound',
  platformInstance: 'https://builderforce.example',
  accountId: 'account-a',
  tenantId: 'tenant-a',
  projectId: 'project-a',
  repository: 'org/repo',
});

/** A transport that records every batch it is asked to push and accepts all. */
function recordingTransport(): SyncTransport & { pushed: SyncPushBatch[] } {
  const pushed: SyncPushBatch[] = [];
  return {
    pushed,
    async push(batch) {
      pushed.push(batch);
      return batch.events.map((event, index) => ({
        eventId: event.eventId,
        status: 'accepted' as const,
        serverId: `server-${index}`,
        serverVersion: 1,
      }));
    },
    async pull() {
      return { records: [], conflicts: [] };
    },
  };
}

/**
 * The coordinator runs under the device-store lease, the same one the host
 * wires. The lease is keyed by a device-store name, so each coordinator gets
 * its own — a shared name would make the second call return undefined while
 * the first still holds the slot.
 */
let leaseSeq = 0;
function coordinator(store: ReturnType<typeof createMemoryLocalFirstStore>, transport: SyncTransport) {
  leaseSeq += 1;
  return createSyncCoordinator({
    store,
    transport,
    policy: createPlatformPolicy({ synchronize: true }),
    deviceId: DEVICE,
    lease: createDeviceStoreCoordinatorLease({
      deviceStore: `creation-destination-${leaseSeq}`,
      now: () => Date.parse(AT),
      ttlMs: 30_000,
    }),
  });
}

describe('resolveCreateDestination', () => {
  it('returns UNBOUND_DESTINATION for every value that is not a bound destination', () => {
    expect(resolveCreateDestination()).toBe(UNBOUND_DESTINATION);
    expect(resolveCreateDestination(null)).toBe(UNBOUND_DESTINATION);
    expect(resolveCreateDestination(undefined)).toBe(UNBOUND_DESTINATION);
    expect(resolveCreateDestination(UNBOUND_DESTINATION)).toBe(UNBOUND_DESTINATION);
    expect(resolveCreateDestination({ kind: 'unbound' })).toBe(UNBOUND_DESTINATION);
    expect(resolveCreateDestination({ kind: 'bound' })).toBe(UNBOUND_DESTINATION);
    expect(resolveCreateDestination({ kind: 'bound', tenantId: '   ' })).toBe(UNBOUND_DESTINATION);
  });

  it('freezes a field-by-field snapshot of a bound destination', () => {
    const caller = { kind: 'bound' as const, tenantId: ' tenant-a ', projectId: 'project-a' };
    const stored = resolveCreateDestination(caller);
    expect(stored).not.toBe(caller);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(stored).toEqual({ kind: 'bound', tenantId: 'tenant-a', projectId: 'project-a' });
    caller.tenantId = 'rewritten';
    expect(stored).toEqual({ kind: 'bound', tenantId: 'tenant-a', projectId: 'project-a' });
  });

  it('refuses an unbound destination when the caller asked for a bound one', () => {
    expect(() => requireBoundCreateDestination()).toThrow(UNBOUND_DESTINATION_CODE);
    expect(requireBoundCreateDestination(BOUND)).toEqual(BOUND);
  });
});

describe('every local create path stores an explicit destination', () => {
  it('names a path for each gated entity type', () => {
    const covered = new Set(LOCAL_CREATE_PATHS.flatMap((path) => path.writes));
    for (const entityType of GATED_CREATE_ENTITY_TYPES) {
      expect(covered.has(entityType)).toBe(true);
    }
    expect(LOCAL_CREATE_PATHS.map((path) => path.id)).toEqual([
      'localWork.createProject',
      'localWork.createTicket',
      'transactionalRecord.commit',
      'hostChatRecord.ensureChat',
      'hostChatRecord.appendRun',
      'localAudit.createLocalAuditFinding',
      'factProvenance.remember',
    ]);
  });

  it('stores UNBOUND_DESTINATION when createProject omits a destination', async () => {
    const store = createMemoryLocalFirstStore();
    const work = createLocalWork(store);
    const project = await work.createProject({ id: 'project-1', name: 'Offline', deviceId: DEVICE, occurredAt: AT });
    expect(hasExplicitDestination(project)).toBe(true);
    expect(project.destination).toBe(UNBOUND_DESTINATION);
    expect(isUnboundDestination(project.destination)).toBe(true);

    const events = await store.read((tx) => tx.pending(UNBOUND_DESTINATION));
    expect(events).toHaveLength(1);
    expect(events[0]?.destination).toEqual({ kind: 'unbound' });
    expect(events[0]?.entityType).toBe('project');
  });

  it('copies the project snapshot onto a ticket, unbound or bound', async () => {
    const store = createMemoryLocalFirstStore();
    const work = createLocalWork(store);
    const project = await work.createProject({ id: 'project-1', name: 'Offline', deviceId: DEVICE, occurredAt: AT });
    const ticket = await work.createTicket({
      id: 'ticket-1',
      projectId: project.id,
      title: 'First',
      deviceId: DEVICE,
      occurredAt: AT,
    });
    expect(ticket.destination).toEqual({ kind: 'unbound' });
    expect(hasExplicitDestination(ticket)).toBe(true);

    const bound = createMemoryLocalFirstStore();
    const boundWork = createLocalWork(bound);
    const boundProject = await boundWork.createProject({
      id: 'project-2',
      name: 'Bound',
      deviceId: DEVICE,
      destination: BOUND,
      occurredAt: AT,
    });
    const boundTicket = await boundWork.createTicket({
      id: 'ticket-2',
      projectId: boundProject.id,
      title: 'Second',
      deviceId: DEVICE,
      occurredAt: AT,
    });
    expect(boundTicket.destination).toEqual(BOUND);
    expect(Object.isFrozen(boundTicket.destination)).toBe(true);
  });

  it('stores an explicit destination on all five records a transactional commit writes', async () => {
    const store = createTransactionalRecordStore();
    const committed = await store.commit({
      deviceId: DEVICE,
      occurredAt: AT,
      project: { id: 'project-1', name: 'Offline' },
      ticket: { id: 'ticket-1', title: 'First' },
      chat: { id: 'chat-1', title: 'Chat' },
      audit: { id: 'audit-1', auditKey: 'soc2-readiness', status: 'running' },
      run: { id: 'run-1', status: 'running' },
    });
    const records = [committed.project, committed.ticket, committed.chat, committed.audit, committed.run];
    const types: LocalEntityType[] = ['project', 'ticket', 'chat', 'audit-run', 'execution'];
    records.forEach((record, index) => {
      expect(record.entityType).toBe(types[index]);
      expect(hasExplicitDestination(record)).toBe(true);
      expect(record.destination).toEqual({ kind: 'unbound' });
    });
    const events = await store.inner.read((tx) => tx.pending(UNBOUND_DESTINATION));
    expect(events).toHaveLength(5);
    expect(events.every((event) => event.destination.kind === 'unbound')).toBe(true);
  });

  it('stores UNBOUND_DESTINATION on a chat opened offline and on the run it records', async () => {
    const store = createMemoryLocalFirstStore();
    const log = createHostChatLog(store);
    const turn = await log.appendTurn({
      chatId: 'chat-1',
      messageId: 'message-1',
      role: 'user',
      text: 'hello',
      deviceId: DEVICE,
      occurredAt: AT,
    });
    expect(turn.destination).toEqual({ kind: 'unbound' });
    const chat = await store.read((tx) => tx.get('chat', 'chat-1'));
    expect(chat?.destination).toEqual({ kind: 'unbound' });
    expect(hasExplicitDestination(chat)).toBe(true);

    const run = await log.appendRun({
      chatId: 'chat-1',
      runId: 'run-1',
      status: 'running',
      deviceId: DEVICE,
      occurredAt: AT,
    });
    expect(run.entityType).toBe('execution');
    expect(run.destination).toEqual({ kind: 'unbound' });
  });

  it('stores UNBOUND_DESTINATION on an audit finding created offline', async () => {
    const store = createMemoryLocalFirstStore();
    const finding = await createLocalAuditFinding(store, {
      id: 'finding-1',
      auditRunId: 'audit-1',
      title: 'Gap',
      deviceId: DEVICE,
      occurredAt: AT,
    });
    expect(finding.entityType).toBe('audit-finding');
    expect(hasExplicitDestination(finding)).toBe(true);
    expect(finding.destination).toEqual({ kind: 'unbound' });
  });

  it('stores UNBOUND_DESTINATION on a memory fact remembered offline', async () => {
    const store = createMemoryLocalFirstStore();
    const facts = createFactStore(store);
    const fact = await facts.remember({
      id: 'fact-1',
      key: 'chat-list-data-source',
      statement: 'The chat list reads the local store.',
      deviceId: DEVICE,
      occurredAt: AT,
      sourceRunId: 'run-1',
    });
    // remember returns the versioned fact, not the LocalRecord. The record is
    // what carries the destination, so the assertion reads it back.
    const record = await store.read((tx) => tx.get('memory-fact', fact.id));
    expect(record?.entityType).toBe('memory-fact');
    expect(hasExplicitDestination(record)).toBe(true);
    expect(record?.destination).toEqual({ kind: 'unbound' });
  });
});

describe('an unbound record is refused at sync until a destination is chosen', () => {
  it('refuses every unbound event and sends nothing', async () => {
    const store = createMemoryLocalFirstStore();
    const work = createLocalWork(store);
    await work.createProject({ id: 'project-1', name: 'Offline', deviceId: DEVICE, occurredAt: AT });
    await work.createTicket({ id: 'ticket-1', projectId: 'project-1', title: 'First', deviceId: DEVICE, occurredAt: AT });

    const transport = recordingTransport();
    const sync = coordinator(store, transport);

    await expect(sync.synchronize(UNBOUND_DESTINATION)).rejects.toThrow(SYNC_DESTINATION_REQUIRED);

    const refused = await sync.refuseUnbound();
    expect(refused).toHaveLength(2);
    expect(refused.every((entry) => entry.code === SYNC_DESTINATION_REQUIRED)).toBe(true);
    expect(refused.map((entry) => entry.entityType).sort()).toEqual(['project', 'ticket']);
    expect(transport.pushed).toHaveLength(0);

    const stillPending = await store.read((tx) => tx.pending(UNBOUND_DESTINATION));
    expect(stillPending).toHaveLength(2);
  });

  it('refuses an unbound event parked in a bound partition instead of pushing it', async () => {
    const store = createMemoryLocalFirstStore();
    const work = createLocalWork(store);
    const project = await work.createProject({
      id: 'project-1',
      name: 'Bound',
      deviceId: DEVICE,
      destination: BOUND,
      occurredAt: AT,
    });
    const ticket = await work.createTicket({
      id: 'ticket-1',
      projectId: project.id,
      title: 'First',
      deviceId: DEVICE,
      occurredAt: AT,
    });
    expect(ticket.destination).toEqual(BOUND);

    // A record rebound on its own, leaving its create event behind with an
    // unbound destination. This is the shape `chooseDestination` exists to
    // prevent. The journal partitions by destination key, so the orphaned
    // event is not in the bound partition at all — a bound sync must not see
    // it, must not push it, and must not count it as pushed.
    await store.transact(async (tx) => {
      const events = await tx.pending(BOUND);
      const ticketEvent = events.find((event) => event.clientEntityId === 'ticket-1');
      expect(ticketEvent).toBeDefined();
      await tx.acknowledge([ticketEvent!.eventId]);
      await tx.append({ ...ticketEvent!, destination: UNBOUND_DESTINATION });
    });

    const transport = recordingTransport();
    const sync = coordinator(store, transport);
    const summary = await sync.synchronize(BOUND);
    expect(summary?.pushed).toBe(1);
    expect(summary?.unboundRefused).toBe(0);
    expect(transport.pushed).toHaveLength(1);
    expect(transport.pushed[0]?.events.map((event) => event.clientEntityId)).toEqual(['project-1']);
    expect(transport.pushed[0]?.events.every((event) => event.destination.kind === 'bound')).toBe(true);

    // The orphaned event is still pending, and it is refused rather than
    // pushed when the unbound partition is asked.
    const refused = await sync.refuseUnbound();
    expect(refused.map((entry) => entry.clientEntityId)).toEqual(['ticket-1']);
    expect(transport.pushed).toHaveLength(1);
  });

  it('becomes syncable once a destination is chosen, record and events together', async () => {
    const store = createTransactionalRecordStore();
    const committed = await store.commit({
      deviceId: DEVICE,
      occurredAt: AT,
      project: { id: 'project-1', name: 'Offline' },
      ticket: { id: 'ticket-1', title: 'First' },
      chat: { id: 'chat-1', title: 'Chat' },
      audit: { id: 'audit-1', auditKey: 'soc2-readiness', status: 'running' },
      run: { id: 'run-1', status: 'running' },
    });
    expect(committed.run.destination).toEqual({ kind: 'unbound' });

    const transport = recordingTransport();
    const sync = coordinator(store.inner, transport);
    const before = await sync.refuseUnbound();
    expect(before).toHaveLength(5);
    expect(transport.pushed).toHaveLength(0);

    const chosen = await chooseDestination(store.inner, {
      record: committed.project,
      destination: BOUND,
      deviceId: DEVICE,
      occurredAt: AT,
    });
    expect(chosen.record.destination).toEqual(BOUND);
    expect(chosen.moved).toHaveLength(5);
    expect(chosen.moved.every((event) => event.destination.kind === 'bound')).toBe(true);

    const after = await sync.refuseUnbound();
    expect(after).toHaveLength(0);

    const summary = await sync.synchronize(BOUND);
    expect(summary?.unboundRefused).toBe(0);
    expect(summary?.pushed).toBe(5);
    expect(transport.pushed).toHaveLength(1);
    const sent = transport.pushed[0]?.events ?? [];
    expect(sent).toHaveLength(5);
    expect(new Set(sent.map((event) => event.entityType))).toEqual(
      new Set(['project', 'ticket', 'chat', 'audit-run', 'execution']),
    );
    expect(sent.every((event) => event.destination.kind === 'bound')).toBe(true);

    const remaining = await store.inner.read((tx) => tx.pending(BOUND));
    expect(remaining).toHaveLength(0);
  });

  it('refuses a record with no destination field the same way it refuses an unbound one', () => {
    const missing = unboundRecordRefusal({ id: 'ticket-1', entityType: 'ticket' });
    const unbound = unboundRecordRefusal({ id: 'ticket-2', entityType: 'ticket', destination: UNBOUND_DESTINATION });
    const bound = unboundRecordRefusal({ id: 'ticket-3', entityType: 'ticket', destination: BOUND });
    expect(missing?.code).toBe(SYNC_DESTINATION_REQUIRED);
    expect(unbound?.code).toBe(SYNC_DESTINATION_REQUIRED);
    expect(bound).toBeNull();
    expect(unboundRecordRefusal(null)?.code).toBe(SYNC_DESTINATION_REQUIRED);
  });

  it('keeps a refused event out of the syncable half, in input order', () => {
    const events = [
      { eventId: 'a', entityType: 'project' as const, clientEntityId: 'p', destination: UNBOUND_DESTINATION },
      { eventId: 'b', entityType: 'ticket' as const, clientEntityId: 't', destination: BOUND },
      { eventId: 'c', entityType: 'chat' as const, clientEntityId: 'c', destination: { kind: 'unbound' as const } },
    ];
    const split = partitionUnboundPending(events as never);
    expect(split.syncable.map((event) => event.eventId)).toEqual(['b']);
    expect(split.refused.map((entry) => entry.eventId)).toEqual(['a', 'c']);
    expect(unboundEventRefusal(events[1] as never)).toBeNull();
    expect(unboundEventRefusal(events[0] as never)?.code).toBe(SYNC_DESTINATION_REQUIRED);
  });
});
