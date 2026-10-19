import { describe, expect, it } from 'vitest';
import type { JournalEvent, LocalRecord, SyncConflict, SyncReceipt } from './records.js';
import { UNBOUND_DESTINATION } from './records.js';
import {
  STORE_SYNC_STATUSES,
  SYNC_STATUSES,
  assertStatusFresh,
  deriveRecordSyncStatus,
  deriveSyncStatus,
  isLocalAuditComplete,
  localAuditCompletionRequiresReceipt,
  localWorkComplete,
  syncShownAsDone,
  type StoreSyncStatus,
  type SyncStatus,
  type SyncStatusStore,
  type SyncStatusStoreEvent,
} from './syncStatus.js';

function record(entityType: LocalRecord['entityType'], id: string, payload: unknown = { title: id }): LocalRecord {
  return {
    id,
    entityType,
    schemaVersion: 1,
    version: 1,
    destination: UNBOUND_DESTINATION,
    occurredAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
    payload,
    provenance: { deviceId: 'device-1', source: 'local' },
  };
}

function event(partial: Partial<JournalEvent> & Pick<JournalEvent, 'eventId' | 'clientEntityId' | 'entityType'>): JournalEvent {
  return {
    operation: 'create',
    schemaVersion: 1,
    localSequence: 1,
    occurredAt: '2026-10-19T00:00:00.000Z',
    dependsOn: [],
    destination: UNBOUND_DESTINATION,
    payload: {},
    payloadHash: 'fnv1a:00000000',
    ...partial,
  };
}

function receipt(eventId: string, status: SyncReceipt['status']): SyncReceipt {
  return { eventId, status, receivedAt: '2026-10-19T00:01:00.000Z' };
}

function conflict(recordId: string, entityType: LocalRecord['entityType'], resolvedAt?: string): SyncConflict {
  const local = record(entityType, recordId);
  return {
    id: `conflict:${recordId}`,
    clientEntityId: recordId,
    entityType,
    local,
    remote: { ...local, version: 2, provenance: { deviceId: 'remote', source: 'imported' } },
    reason: 'pending_local_mutation_overlaps_remote_version',
    createdAt: '2026-10-19T00:02:00.000Z',
    ...(resolvedAt ? { resolvedAt } : {}),
  };
}

const STATUSES: readonly SyncStatus[] = ['local', 'syncing', 'synced', 'conflict', 'dead-letter'];

describe('deriveSyncStatus', () => {
  it('exposes exactly the five store-derived statuses', () => {
    expect([...SYNC_STATUSES]).toEqual([...STATUSES]);
  });

  it('is local when the record has no receipt and no pending event', () => {
    for (const entityType of ['chat', 'ticket', 'execution', 'audit-run'] as const) {
      const status = deriveSyncStatus({ record: record(entityType, `${entityType}-1`) });
      expect(status).toBe('local');
      expect(SYNC_STATUSES).toContain(status);
    }
  });

  it('ignores another record\'s pending event, receipt, and conflict', () => {
    const mine = record('ticket', 'ticket-1');
    const status = deriveSyncStatus({
      record: mine,
      events: [event({ eventId: 'other', clientEntityId: 'ticket-2', entityType: 'ticket', localSequence: 9 })],
      receipts: [receipt('other', 'accepted')],
      conflicts: [conflict('ticket-2', 'ticket')],
    });
    expect(status).toBe('local');
  });

  it('is syncing when a pending event has no receipt', () => {
    const row = record('chat', 'chat-1');
    const status = deriveSyncStatus({
      record: row,
      events: [event({ eventId: 'e1', clientEntityId: 'chat-1', entityType: 'chat' })],
    });
    expect(status).toBe('syncing');
    expect(syncShownAsDone(row, status)).toBe(false);
  });

  it('is synced on an accepted or duplicate receipt with no newer pending event', () => {
    const row = record('ticket', 'ticket-1');
    const pending = [event({ eventId: 'e1', clientEntityId: 'ticket-1', entityType: 'ticket', localSequence: 3 })];
    expect(deriveSyncStatus({ record: row, events: pending, receipts: [receipt('e1', 'accepted')] })).toBe('synced');
    expect(deriveSyncStatus({ record: row, events: [], receipts: [receipt('e1', 'duplicate')] })).toBe('synced');
    expect(syncShownAsDone(row, 'synced')).toBe(true);
  });

  it('is syncing when a newer pending event has no receipt', () => {
    const row = record('execution', 'run-1');
    const status = deriveSyncStatus({
      record: row,
      events: [
        event({ eventId: 'e1', clientEntityId: 'run-1', entityType: 'execution', localSequence: 1 }),
        event({ eventId: 'e2', clientEntityId: 'run-1', entityType: 'execution', localSequence: 2 }),
      ],
      receipts: [receipt('e1', 'accepted')],
    });
    expect(status).toBe('syncing');
    expect(syncShownAsDone(row, status)).toBe(false);
  });

  it('uses localSequence, not array order, to decide the newest event', () => {
    const row = record('chat', 'chat-1');
    const status = deriveSyncStatus({
      record: row,
      events: [
        event({
          eventId: 'newer',
          clientEntityId: 'chat-1',
          entityType: 'chat',
          localSequence: 4,
          deadLetter: { reason: 'permanent', at: '2026-10-19T00:03:00.000Z' },
        }),
        event({ eventId: 'older', clientEntityId: 'chat-1', entityType: 'chat', localSequence: 1 }),
      ],
      receipts: [receipt('older', 'accepted')],
    });
    expect(status).toBe('dead-letter');
  });

  it('is conflict when a conflict is open, even if a receipt already settled an event', () => {
    const row = record('ticket', 'ticket-1');
    const status = deriveSyncStatus({
      record: row,
      events: [event({ eventId: 'e1', clientEntityId: 'ticket-1', entityType: 'ticket' })],
      receipts: [receipt('e1', 'accepted')],
      conflicts: [conflict('ticket-1', 'ticket')],
    });
    expect(status).toBe('conflict');
    expect(syncShownAsDone(row, status)).toBe(false);
  });

  it('treats a conflict receipt as open until a SyncConflict for this record is resolved', () => {
    const row = record('chat', 'chat-1');
    const pending = [event({ eventId: 'e1', clientEntityId: 'chat-1', entityType: 'chat' })];
    expect(deriveSyncStatus({
      record: row,
      events: pending,
      receipts: [receipt('e1', 'conflict')],
    })).toBe('conflict');
    expect(deriveSyncStatus({
      record: row,
      events: [],
      receipts: [receipt('e1', 'accepted')],
      conflicts: [conflict('chat-1', 'chat', '2026-10-19T00:04:00.000Z')],
    })).toBe('synced');
  });

  it('is dead-letter when the newest event is dead-lettered, and not when only an older one is', () => {
    const row = record('execution', 'run-1');
    expect(deriveSyncStatus({
      record: row,
      events: [event({
        eventId: 'e1',
        clientEntityId: 'run-1',
        entityType: 'execution',
        deadLetter: { reason: 'rejected', at: '2026-10-19T00:03:00.000Z' },
      })],
    })).toBe('dead-letter');
    expect(deriveSyncStatus({
      record: row,
      events: [
        event({
          eventId: 'old',
          clientEntityId: 'run-1',
          entityType: 'execution',
          localSequence: 1,
          deadLetter: { reason: 'rejected', at: '2026-10-19T00:03:00.000Z' },
        }),
        event({ eventId: 'new', clientEntityId: 'run-1', entityType: 'execution', localSequence: 2 }),
      ],
    })).toBe('syncing');
    expect(syncShownAsDone(row, 'dead-letter')).toBe(false);
  });

  it('lets an open conflict win over a dead letter on the newest event', () => {
    const row = record('ticket', 'ticket-1');
    expect(deriveSyncStatus({
      record: row,
      events: [event({
        eventId: 'e1',
        clientEntityId: 'ticket-1',
        entityType: 'ticket',
        deadLetter: { reason: 'give-up', at: '2026-10-19T00:03:00.000Z' },
      })],
      conflicts: [conflict('ticket-1', 'ticket')],
    })).toBe('conflict');
  });

  it('does not treat a rejected or dependency_pending receipt as synced', () => {
    const row = record('chat', 'chat-1');
    const pending = [event({ eventId: 'e1', clientEntityId: 'chat-1', entityType: 'chat' })];
    expect(deriveSyncStatus({ record: row, events: pending, receipts: [receipt('e1', 'rejected')] })).toBe('syncing');
    expect(deriveSyncStatus({ record: row, events: pending, receipts: [receipt('e1', 'dependency_pending')] })).toBe('syncing');
    expect(deriveSyncStatus({ record: row, events: [], receipts: [receipt('e1', 'rejected')] })).toBe('dead-letter');
    expect(syncShownAsDone(row, 'syncing')).toBe(false);
    expect(localWorkComplete(row, 'syncing')).toBe(false);
    expect(localWorkComplete(row, 'local')).toBe(false);
  });

  it('derives pending, in-flight, conflict, and dead-letter from the events passed in', () => {
    const row = record('ticket', 'ticket-1');
    const pending = event({ eventId: 'e1', clientEntityId: 'ticket-1', entityType: 'ticket' });
    const labeled = { ...row, syncStatus: 'synced', status: 'done' } as LocalRecord;
    const input = {
      record: labeled,
      events: [] as JournalEvent[],
      receipts: [] as SyncReceipt[],
      conflicts: [] as SyncConflict[],
    };

    expect(deriveRecordSyncStatus(input)).toBe('local');
    expect(deriveRecordSyncStatus(input)).toBe(deriveSyncStatus(input));
    expect(syncShownAsDone(labeled, deriveRecordSyncStatus(input))).toBe(false);

    input.events = [pending];
    const inFlight = deriveRecordSyncStatus(input);
    expect(inFlight).toBe('syncing');
    expect(inFlight).toBe(deriveSyncStatus(input));
    expect(syncShownAsDone(labeled, inFlight)).toBe(false);
    expect(localWorkComplete(labeled, inFlight)).toBe(false);

    input.conflicts = [conflict('ticket-1', 'ticket')];
    expect(deriveRecordSyncStatus(input)).toBe('conflict');
    expect(syncShownAsDone(labeled, deriveRecordSyncStatus(input))).toBe(false);
    input.conflicts = [];

    input.events = [{ ...pending, deadLetter: { reason: 'denied', at: '2026-10-19T00:03:00.000Z' } }];
    expect(deriveRecordSyncStatus(input)).toBe('dead-letter');
    expect(syncShownAsDone(labeled, deriveRecordSyncStatus(input))).toBe(false);
  });

  it('does not show a denied or still-pending sync as done', () => {
    for (const entityType of ['chat', 'ticket', 'execution', 'audit-run'] as const) {
      const row = record(entityType, `${entityType}-denied`);
      const pending = [event({ eventId: 'e1', clientEntityId: row.id, entityType })];
      const deniedWhilePending = deriveRecordSyncStatus({
        record: row,
        events: pending,
        receipts: [receipt('e1', 'rejected')],
      });
      expect(deniedWhilePending).toBe('syncing');
      expect(deniedWhilePending).toBe(deriveSyncStatus({
        record: row,
        events: pending,
        receipts: [receipt('e1', 'rejected')],
      }));
      expect(syncShownAsDone(row, deniedWhilePending)).toBe(false);
      expect(localWorkComplete(row, deniedWhilePending)).toBe(false);

      const stillPending = deriveRecordSyncStatus({ record: row, events: pending });
      expect(stillPending).toBe('syncing');
      expect(syncShownAsDone(row, stillPending)).toBe(false);

      const waiting = deriveRecordSyncStatus({
        record: row,
        events: pending,
        receipts: [receipt('e1', 'dependency_pending')],
      });
      expect(waiting).toBe('syncing');
      expect(syncShownAsDone(row, waiting)).toBe(false);

      const deniedAfterDrop = deriveRecordSyncStatus({
        record: row,
        events: [],
        receipts: [receipt('e1', 'rejected')],
      });
      expect(deniedAfterDrop).toBe('dead-letter');
      expect(syncShownAsDone(row, deniedAfterDrop)).toBe(false);
      expect(localWorkComplete(row, deniedAfterDrop)).toBe(false);

      const waitingAfterDrop = deriveRecordSyncStatus({
        record: row,
        events: [],
        receipts: [receipt('e1', 'dependency_pending')],
      });
      expect(waitingAfterDrop).not.toBe('synced');
      expect(syncShownAsDone(row, waitingAfterDrop)).toBe(false);
    }
  });
});

describe('local audit completion', () => {
  it('does not require a receipt, and a missing upload is not synced', () => {
    const completed = record('audit-run', 'audit-1', { status: 'completed' });
    const status = deriveSyncStatus({ record: completed, events: [], receipts: [], conflicts: [] });
    expect(status).toBe('local');
    expect(localAuditCompletionRequiresReceipt()).toBe(false);
    expect(isLocalAuditComplete(completed)).toBe(true);
    expect(localWorkComplete(completed, status)).toBe(true);
    expect(syncShownAsDone(completed, status)).toBe(true);
  });

  it('stays complete while the completion event is still uploading', () => {
    const completed = record('audit-run', 'audit-1', { status: 'completed' });
    const status = deriveSyncStatus({
      record: completed,
      events: [event({ eventId: 'audit-run:complete:audit-1', clientEntityId: 'audit-1', entityType: 'audit-run' })],
    });
    expect(status).toBe('syncing');
    expect(isLocalAuditComplete(completed)).toBe(true);
    expect(localWorkComplete(completed, status)).toBe(true);
    expect(syncShownAsDone(completed, status)).toBe(true);
    expect(localAuditCompletionRequiresReceipt()).toBe(false);
  });

  it('does not treat a running audit, or a non-audit, as locally complete', () => {
    const running = record('audit-run', 'audit-2', { status: 'running' });
    expect(isLocalAuditComplete(running)).toBe(false);
    expect(localWorkComplete(running, 'local')).toBe(false);
    expect(syncShownAsDone(running, 'local')).toBe(false);
    expect(isLocalAuditComplete(record('chat', 'chat-1'))).toBe(false);
    expect(isLocalAuditComplete(record('audit-run', 'audit-3', null))).toBe(false);
  });

  it('does not hide a conflict or dead letter on a completed audit', () => {
    const completed = record('audit-run', 'audit-1', { status: 'completed' });
    expect(localWorkComplete(completed, 'conflict')).toBe(true);
    expect(syncShownAsDone(completed, 'conflict')).toBe(false);
    expect(syncShownAsDone(completed, 'dead-letter')).toBe(false);
  });
});

describe('deriveSyncStatus(store)', () => {
  const idleReachable: SyncStatusStore = { reachable: true, events: [] };
  const idleUnreachable: SyncStatusStore = { reachable: false, events: [] };

  function store(partial: Partial<SyncStatusStore> & Pick<SyncStatusStore, 'reachable'>): SyncStatusStore {
    return { events: [], ...partial };
  }

  it('exposes the four store-derived statuses', () => {
    expect([...STORE_SYNC_STATUSES]).toEqual(['idle', 'pending', 'conflict', 'offline']);
  });

  it('is idle when there are no pending events, even if the store is unreachable', () => {
    expect(deriveSyncStatus(idleReachable)).toBe('idle');
    expect(deriveSyncStatus(idleUnreachable)).toBe('idle');
    expect(deriveSyncStatus(store({ reachable: false }))).toBe('idle');
    expect(deriveSyncStatus(store({ reachable: false, events: [{ sent: true }] }))).toBe('idle');
    expect(deriveSyncStatus(store({ reachable: true, events: [{ status: 'sent' }, { state: 'settled' }] }))).toBe('idle');
  });

  it('is never offline when the store is reachable and nothing is pending', () => {
    expect(deriveSyncStatus(idleReachable)).not.toBe('offline');
    expect(deriveSyncStatus(store({ reachable: true, events: [{ sent: true }] }))).toBe('idle');
  });

  it('is pending when any event is unsent and the store is reachable', () => {
    expect(deriveSyncStatus(store({ reachable: true, events: [{ unsent: true }] }))).toBe('pending');
    expect(deriveSyncStatus(store({
      reachable: true,
      events: [{ sent: true }, { unsent: true }],
    }))).toBe('pending');
    expect(deriveSyncStatus(store({ reachable: true, events: [{}] }))).toBe('pending');
  });

  it('is conflict when any event is in conflict, including while unreachable', () => {
    const conflicted: SyncStatusStoreEvent = { conflict: true };
    expect(deriveSyncStatus(store({ reachable: true, events: [conflicted] }))).toBe('conflict');
    expect(deriveSyncStatus(store({ reachable: false, events: [conflicted, { unsent: true }] }))).toBe('conflict');
    expect(deriveSyncStatus(store({ reachable: true, events: [{ inConflict: true }] }))).toBe('conflict');
    expect(deriveSyncStatus(store({ reachable: true, events: [{ status: 'conflict' }] }))).toBe('conflict');
  });

  it('is offline only when unreachable and at least one pending event is not a conflict', () => {
    expect(deriveSyncStatus(store({ reachable: false, events: [{ unsent: true }] }))).toBe('offline');
    expect(deriveSyncStatus(store({ reachable: false, events: [{}] }))).toBe('offline');
    expect(deriveSyncStatus(store({ reachable: false, events: [{ pending: true }] }))).toBe('offline');
    expect(deriveSyncStatus(store({ reachable: true, events: [{ unsent: true }] }))).not.toBe('offline');
    expect(deriveSyncStatus(idleUnreachable)).not.toBe('offline');
  });

  it('reads journal events and receipts from the store instead of a flag', () => {
    const pending = event({ eventId: 'e1', clientEntityId: 'ticket-1', entityType: 'ticket' });
    expect(deriveSyncStatus(store({ reachable: true, events: [pending] }))).toBe('pending');
    expect(deriveSyncStatus(store({ reachable: false, events: [pending] }))).toBe('offline');
    expect(deriveSyncStatus(store({
      reachable: true,
      events: [pending],
      receipts: [receipt('e1', 'accepted')],
    }))).toBe('idle');
    expect(deriveSyncStatus(store({
      reachable: false,
      events: [pending],
      receipts: [receipt('e1', 'conflict')],
    }))).toBe('conflict');
    expect(deriveSyncStatus(store({
      reachable: true,
      events: [pending],
      conflicts: [conflict('ticket-1', 'ticket')],
    }))).toBe('conflict');
    expect(deriveSyncStatus(store({
      reachable: false,
      events: [pending],
      receipts: [receipt('e1', 'accepted')],
      conflicts: [conflict('ticket-1', 'ticket', '2026-10-19T00:04:00.000Z')],
    }))).toBe('idle');
  });

  it('does not treat a denied or in-flight event as done', () => {
    const pending = event({ eventId: 'e1', clientEntityId: 'ticket-1', entityType: 'ticket' });
    expect(deriveSyncStatus(store({
      reachable: true,
      events: [pending],
      receipts: [receipt('e1', 'rejected')],
    }))).toBe('pending');
    expect(deriveSyncStatus(store({
      reachable: true,
      events: [pending],
      receipts: [receipt('e1', 'dependency_pending')],
    }))).toBe('pending');
    expect(deriveSyncStatus(store({ reachable: true, events: [{ pending: true }] }))).toBe('pending');
    expect(deriveSyncStatus(store({ reachable: true, events: [{ status: 'in-flight' }] }))).toBe('pending');
    expect(deriveSyncStatus(store({ reachable: true, events: [{ state: 'syncing' }] }))).toBe('pending');
    expect(deriveSyncStatus(store({
      reachable: true,
      events: [{ deadLetter: { reason: 'denied', at: '2026-10-19T00:03:00.000Z' } }],
    }))).toBe('pending');
    expect(deriveSyncStatus(store({
      reachable: false,
      events: [pending],
      receipts: [receipt('e1', 'rejected')],
    }))).toBe('offline');
  });

  it('computes status from the store on every read, with no internal cache', () => {
    const live: { reachable: boolean; events: SyncStatusStoreEvent[] } = { reachable: true, events: [] };
    expect(deriveSyncStatus(live)).toBe('idle');
    live.events = [{ unsent: true }];
    expect(deriveSyncStatus(live)).toBe('pending');
    live.reachable = false;
    expect(deriveSyncStatus(live)).toBe('offline');
    live.events = [{ conflict: true }];
    expect(deriveSyncStatus(live)).toBe('conflict');
    live.events = [];
    expect(deriveSyncStatus(live)).toBe('idle');
  });
});

describe('assertStatusFresh', () => {
  it('returns the newly derived status even when it differs from the cached previous', () => {
    const idle = { reachable: true, events: [] };
    const offline = { reachable: false, events: [{ unsent: true }] };
    const pending = { reachable: true, events: [{ unsent: true }] };
    const conflicted = { reachable: true, events: [{ conflict: true }] };

    const cases: Array<[string, SyncStatusStore, StoreSyncStatus]> = [
      ['offline', idle, 'idle'],
      ['pending', idle, 'idle'],
      ['conflict', idle, 'idle'],
      ['syncing', idle, 'idle'],
      ['idle', offline, 'offline'],
      ['offline', pending, 'pending'],
      ['idle', conflicted, 'conflict'],
      ['pending', conflicted, 'conflict'],
      ['synced', {
        reachable: true,
        events: [event({ eventId: 'e1', clientEntityId: 'ticket-1', entityType: 'ticket' })],
        receipts: [receipt('e1', 'rejected')],
      }, 'pending'],
      ['done', {
        reachable: true,
        events: [event({
          eventId: 'e1',
          clientEntityId: 'ticket-1',
          entityType: 'ticket',
          deadLetter: { reason: 'denied', at: '2026-10-19T00:03:00.000Z' },
        })],
      }, 'pending'],
    ];
    for (const [previous, current, expected] of cases) {
      expect(assertStatusFresh(previous, current)).toBe(expected);
      expect(assertStatusFresh(previous, current)).toBe(deriveSyncStatus(current));
      expect(assertStatusFresh(previous, current)).not.toBe(previous);
    }
  });
});
