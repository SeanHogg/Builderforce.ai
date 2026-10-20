import { describe, expect, it, vi } from 'vitest';
import { createLocalWork } from './localWork.js';
import { createPlatformPolicy } from './policy.js';
import { destinationKey, UNBOUND_DESTINATION, type EntityDestination } from './records.js';
import { createMemoryLocalFirstStore } from './store.js';
import { createSyncCoordinator, type SyncPushBatch, type SyncTransport } from './sync.js';
import {
  destinationsForSync,
  readOfflineDestinations,
  rebindDestination,
  snapshottedDestinationKey,
} from './destinationRebind.js';
import { snapshotDestination } from './destinationSnapshot.js';

const CAPTURED_AT = '2026-10-18T12:00:00.000Z';
const NEXT_AT = '2026-10-18T13:00:00.000Z';

const snapshot = snapshotDestination({
  accountId: 'acct-1',
  tenantId: 'tenant-a',
  projectId: 'project-1',
  capturedAt: CAPTURED_AT,
});

const proposed = {
  accountId: 'acct-1',
  tenantId: 'tenant-a',
  projectId: 'project-2',
  capturedAt: NEXT_AT,
};

describe('rebindDestination', () => {
  it('blocks rebind while outbound work is pending', () => {
    const flagged = rebindDestination({ snapshot, proposed, pending: true });
    const unsent = rebindDestination({ snapshot, proposed, unsentEventId: 'evt-9' });
    const nested = rebindDestination({
      snapshot,
      proposed,
      pending: { pending: false, unsentEventId: 'evt-3' },
    });
    const flaggedObject = rebindDestination({
      snapshot,
      proposed,
      pending: { pending: true },
    });

    expect(flagged).toEqual({ ok: false, reason: 'pending_outbound' });
    expect(unsent).toEqual({ ok: false, reason: 'pending_outbound' });
    expect(nested).toEqual({ ok: false, reason: 'pending_outbound' });
    expect(flaggedObject).toEqual({ ok: false, reason: 'pending_outbound' });
    expect(flagged).not.toHaveProperty('destination');
    expect(JSON.stringify(flagged)).not.toContain('project-2');
    expect(snapshot).toEqual({
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
      capturedAt: CAPTURED_AT,
    });
  });

  it('returns a new snapshot for an explicit rebind with no pending work', () => {
    const input = { ...proposed };
    const bound: EntityDestination = {
      kind: 'bound',
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
    };
    const result = rebindDestination({
      snapshot: bound,
      proposed: input,
      pending: false,
      unsentEventId: '',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.destination).toEqual({
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-2',
      capturedAt: NEXT_AT,
    });
    expect(result.destination).not.toBe(input);
    expect(Object.isFrozen(result.destination)).toBe(true);
    input.projectId = 'project-mutated';
    expect(result.destination.projectId).toBe('project-2');
    expect(bound).toEqual({
      kind: 'bound',
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
    });
    expect(snapshot.projectId).toBe('project-1');
  });

  it('does not fall back to a live lookup when the new destination is omitted', () => {
    const taskProjectId = vi.fn(() => ({
      accountId: 'acct-live',
      tenantId: 'tenant-live',
      projectId: 'project-live',
    }));
    const omitted = rebindDestination({
      snapshot,
      pending: false,
      liveLookup: taskProjectId,
      liveSelection: { projectId: 'project-selected-now', tenantId: 'tenant-selected' },
    });
    const explicit = rebindDestination({
      snapshot,
      proposed,
      pending: false,
      liveLookup: taskProjectId,
      liveSelection: { projectId: 'project-selected-now', tenantId: 'tenant-selected' },
    });

    expect(taskProjectId).not.toHaveBeenCalled();
    expect(omitted).toEqual({ ok: false, reason: 'destination_required' });
    expect(omitted).not.toHaveProperty('destination');
    expect(JSON.stringify(omitted)).not.toContain('project-live');
    expect(JSON.stringify(omitted)).not.toContain('project-selected-now');
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.destination.projectId).toBe('project-2');
    expect(explicit.destination.tenantId).toBe('tenant-a');
    expect(JSON.stringify(explicit)).not.toContain('project-selected-now');
    expect(JSON.stringify(explicit)).not.toContain('project-live');
    expect(snapshot.projectId).toBe('project-1');
  });
});

const PARENT_A: EntityDestination = Object.freeze({
  kind: 'bound',
  accountId: 'acct-1',
  tenantId: 'tenant-a',
  projectId: 'project-1',
});

const PARENT_B: EntityDestination = Object.freeze({
  kind: 'bound',
  accountId: 'acct-1',
  tenantId: 'tenant-a',
  projectId: 'project-9',
});

const AT = '2026-10-18T12:00:00.000Z';

describe('snapshotted destination reads', () => {
  it('reads the written destinationKey after the live parent moves', () => {
    const written = { destination: PARENT_A, destinationKey: destinationKey(PARENT_A) };
    const liveParent = { destination: PARENT_A };
    liveParent.destination = PARENT_B;
    const taskProjectId = vi.fn(() => PARENT_B);

    expect(snapshottedDestinationKey(written, liveParent)).toBe(destinationKey(PARENT_A));
    expect(snapshottedDestinationKey(written, taskProjectId)).toBe(destinationKey(PARENT_A));
    expect(taskProjectId).not.toHaveBeenCalled();
    expect(readOfflineDestinations([written], taskProjectId)).toEqual([
      { record: written, destinationKey: destinationKey(PARENT_A) },
    ]);
    expect(written.destination).toBe(PARENT_A);
  });

  it('does not call a destination getter or rebind when the parent changes', () => {
    const taskProjectId = vi.fn(() => PARENT_B);
    const written = {
      get destination() {
        return taskProjectId();
      },
      destinationKey: destinationKey(PARENT_A),
    };

    expect(snapshottedDestinationKey(written, taskProjectId)).toBe(destinationKey(PARENT_A));
    expect(taskProjectId).not.toHaveBeenCalled();

    const implicit = rebindDestination({
      snapshot: PARENT_A,
      liveLookup: taskProjectId,
      liveSelection: PARENT_B,
    });
    expect(implicit).toEqual({ ok: false, reason: 'destination_required' });
    expect(taskProjectId).not.toHaveBeenCalled();
    const explicit = rebindDestination({ snapshot: PARENT_A, proposed: PARENT_B, pending: false });
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.destination.projectId).toBe('project-9');
    expect(PARENT_A.projectId).toBe('project-1');
  });

  it('plans sync from the written snapshot and refuses an unbound event', () => {
    const source: EntityDestination = {
      kind: 'bound',
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
    };
    const taskProjectId = vi.fn(() => PARENT_B);
    const planned = destinationsForSync(
      [{ destination: source }, { destination: UNBOUND_DESTINATION }],
      [{ destination: PARENT_B }],
      taskProjectId,
    );

    expect(taskProjectId).not.toHaveBeenCalled();
    expect(planned.unboundRefused).toBe(1);
    expect(planned.bound).toHaveLength(2);
    expect(planned.bound.map((destination) => destinationKey(destination)).sort()).toEqual(
      [destinationKey(PARENT_A), destinationKey(PARENT_B)].sort(),
    );
    source.projectId = 'project-9';
    expect(planned.bound.find((destination) => destination.projectId === 'project-1')?.projectId).toBe('project-1');
    expect(planned.bound.every((destination) => Object.isFrozen(destination))).toBe(true);
  });

  it('throws when the snapshot is missing and does not call the live parent', () => {
    const taskProjectId = vi.fn(() => PARENT_B);
    expect(() => snapshottedDestinationKey({}, taskProjectId)).toThrow(/destination_snapshot_required/);
    expect(taskProjectId).not.toHaveBeenCalled();
  });
});

describe('sync and offline reads keep the snapshotted destination', () => {
  it('pushes a written record to parent A after the live parent moves to B, without rebinding', async () => {
    const store = createMemoryLocalFirstStore();
    const work = createLocalWork(store);
    const project = await work.createProject({
      id: 'project-1',
      name: 'Offline',
      deviceId: 'device-1',
      destination: PARENT_A,
      occurredAt: AT,
    });
    const ticket = await work.createTicket({
      id: 'ticket-1',
      projectId: project.id,
      title: 'Written against A',
      deviceId: 'device-1',
      occurredAt: AT,
    });
    const writtenKey = destinationKey(ticket.destination);
    expect(writtenKey).toBe(destinationKey(PARENT_A));

    await store.transact((tx) => tx.append({
      eventId: 'unbound-extra',
      clientEntityId: 'loose',
      entityType: 'ticket',
      operation: 'create',
      schemaVersion: 1,
      occurredAt: AT,
      dependsOn: [],
      destination: UNBOUND_DESTINATION,
      payload: { title: 'loose' },
    }));

    const liveParent = { destination: PARENT_A };
    liveParent.destination = PARENT_B;
    const taskProjectId = vi.fn(() => PARENT_B);
    const pushed: SyncPushBatch[] = [];
    const transport: SyncTransport = {
      pull: async () => ({ records: [], cursor: 'cursor-a' }),
      push: async (batch) => {
        pushed.push(batch);
        return batch.events.map((event) => ({
          eventId: event.eventId,
          status: 'accepted' as const,
          receivedAt: AT,
          serverId: `server-${event.clientEntityId}`,
          serverVersion: 1,
        }));
      },
    };
    const coordinator = createSyncCoordinator({
      store,
      transport,
      policy: createPlatformPolicy({ synchronize: true }),
      deviceId: 'device-1',
      lease: { run: async (_owner, run) => run() },
      newId: () => 'batch-snapshot',
      now: () => new Date(AT),
    });

    const ignored = await coordinator.synchronize(PARENT_B);
    expect(ignored?.pushed).toBe(0);
    expect(pushed).toHaveLength(0);
    expect(taskProjectId).not.toHaveBeenCalled();

    const offline = await coordinator.readOffline(taskProjectId);
    const offlineTicket = offline.find((entry) => entry.record.id === 'ticket-1');
    expect(offlineTicket?.destinationKey).toBe(writtenKey);
    expect(taskProjectId).not.toHaveBeenCalled();

    const summary = await coordinator.synchronizeSnapshotted({
      liveParent,
      liveLookup: taskProjectId,
    });
    expect(taskProjectId).not.toHaveBeenCalled();
    expect(summary?.pushed).toBe(2);
    expect(summary?.unboundRefused).toBe(1);
    expect(pushed).toHaveLength(1);
    expect(destinationKey(pushed[0]!.destination)).toBe(writtenKey);
    expect(pushed[0]!.events.map((event) => event.clientEntityId).sort()).toEqual(['project-1', 'ticket-1']);
    expect(pushed[0]!.events.every((event) => destinationKey(event.destination) === writtenKey)).toBe(true);
    expect(JSON.stringify(pushed)).not.toContain('project-9');

    const stored = await store.read((tx) => tx.get('ticket', 'ticket-1'));
    expect(stored?.destination).toEqual(ticket.destination);
    expect(destinationKey(stored!.destination)).toBe(writtenKey);
    expect(await store.read((tx) => tx.pending(UNBOUND_DESTINATION))).toHaveLength(1);

    const implicit = rebindDestination({
      snapshot: stored!.destination,
      liveLookup: taskProjectId,
      liveSelection: PARENT_B,
    });
    expect(implicit).toEqual({ ok: false, reason: 'destination_required' });
    expect(taskProjectId).not.toHaveBeenCalled();
    expect((await store.read((tx) => tx.get('ticket', 'ticket-1')))?.destination).toEqual(ticket.destination);
  });
});
