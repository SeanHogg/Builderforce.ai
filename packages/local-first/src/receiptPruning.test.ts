import { describe, expect, it } from 'vitest';
import { pruneSettledReceipts } from './receiptPruning.js';
import { deriveRecordSyncStatus, hasServerMapping } from './syncStatus.js';
import { newLocalRecord } from './store.js';
import type { EntityDestination, JournalEvent, LocalRecord, ServerMapping, SyncConflict, SyncReceipt } from './records.js';

const BOUND: EntityDestination = { kind: 'bound', platformInstance: 'https://example.test', tenantId: '1' };
const row = (id: string): LocalRecord => ({ ...newLocalRecord({ id, entityType: 'message', payload: {}, deviceId: 'd' }), destination: BOUND });
const receipt = (eventId: string, clientEntityId: string | undefined, status: SyncReceipt['status'], receivedAt = '2026-11-10T00:00:00.000Z'): SyncReceipt =>
  (clientEntityId === undefined ? { eventId, status, receivedAt } : { eventId, entityType: 'message', clientEntityId, status, receivedAt });
const mapping = (clientEntityId: string, serverVersion = 1): ServerMapping =>
  ({ destination: BOUND, entityType: 'message', clientEntityId, syncId: 1, serverId: '1', serverVersion } as ServerMapping);
const event = (eventId: string, clientEntityId: string, over: Partial<JournalEvent> = {}): JournalEvent => ({
  eventId, clientEntityId, entityType: 'message', operation: 'update', destination: BOUND, dependsOn: [], payload: {},
  payloadHash: 'h', localSequence: 9, schemaVersion: 1, occurredAt: '2026-11-10T00:00:01.000Z', ...over,
} as JournalEvent);

type Facts = { events: JournalEvent[]; mappings: ServerMapping[]; receipts: SyncReceipt[]; conflicts: SyncConflict[] };
const statusOf = (record: LocalRecord, facts: Facts) => deriveRecordSyncStatus({
  record, events: facts.events, receipts: facts.receipts, conflicts: facts.conflicts, mapped: hasServerMapping(record, facts.mappings),
});

describe('pruneSettledReceipts', () => {
  const ids = ['synced', 'synced2', 'pending', 'mixed', 'conflicted', 'dead', 'held', 'unmapped', 'boundOnly', 'newest', 'openConflict'];
  const records = ids.map(row);
  const facts: Facts = {
    events: [
      event('e-pending-2', 'pending'),
      event('e-dead', 'dead', { deadLetter: { reason: 'payload_invalid', at: 'x' } }),
      event('e-held', 'held', { holdAttempts: 1, holdKind: 'dependency_pending', nextAttemptAt: 'x' }),
    ],
    mappings: ['synced', 'synced2', 'pending', 'mixed', 'conflicted', 'dead', 'held', 'newest', 'openConflict'].map((id) => mapping(id)).concat(mapping('boundOnly', 0)),
    receipts: [
      // All of `synced`'s receipts go: it must still read synced, through its mapping.
      receipt('e-synced-1', 'synced', 'accepted'),
      receipt('e-synced-2', 'synced', 'duplicate'),
      receipt('e-synced2', 'synced2', 'accepted'),
      receipt('e-pending', 'pending', 'accepted'),
      receipt('e-mixed-1', 'mixed', 'accepted'),
      receipt('e-mixed-2', 'mixed', 'rejected'),
      receipt('e-conflicted-1', 'conflicted', 'accepted'),
      receipt('e-conflicted-2', 'conflicted', 'conflict'),
      receipt('e-dead-1', 'dead', 'accepted'),
      receipt('e-held', 'held', 'dependency_pending'),
      receipt('e-held-1', 'held', 'accepted'),
      receipt('e-unmapped', 'unmapped', 'accepted'),
      receipt('e-bound-only', 'boundOnly', 'duplicate'),
      receipt('e-open-conflict', 'openConflict', 'accepted'),
      // A legacy receipt naming no row: never assumed to be anyone's, never pruned.
      receipt('e-legacy', undefined, 'accepted'),
      // The newest push of the store, on a row of its own: kept for "last push".
      receipt('e-newest', 'newest', 'accepted', '2026-11-11T00:00:00.000Z'),
    ],
    conflicts: [{ id: 'c1', entityType: 'message', clientEntityId: 'openConflict', reason: 'x', createdAt: 'x' } as SyncConflict],
  };

  it('drops only settled receipts of imported rows with nothing pending and nothing unsettled; keeps the newest push', () => {
    const pruned = pruneSettledReceipts(facts);
    expect(pruned.receipts.map((r) => r.eventId).sort()).toEqual([
      'e-bound-only', 'e-conflicted-1', 'e-conflicted-2', 'e-dead-1', 'e-held', 'e-held-1', 'e-legacy',
      'e-mixed-1', 'e-mixed-2', 'e-newest', 'e-pending', 'e-unmapped',
    ]);
  });

  // This build's status read and the one shipped in 87e4b88cc are the same function (diffed: identical),
  // so "no status changes here" is "no status changes in an older window" too.
  it('changes no row\'s status — a row with ALL its receipts gone still reads synced through its mapping', () => {
    const pruned = pruneSettledReceipts(facts);
    for (const record of records) expect(statusOf(record, pruned), record.id).toBe(statusOf(record, facts));
    expect(statusOf(records[0]!, pruned)).toBe('synced');
    expect(pruned.receipts.some((r) => r.clientEntityId === 'synced')).toBe(false);
  });

  it('an edit after pruning reads syncing, then synced again once its receipt lands', () => {
    const pruned = pruneSettledReceipts(facts);
    const edit = event('e-edit', 'synced');
    const edited = { ...pruned, events: [...pruned.events, edit] };
    expect(statusOf(records[0]!, edited)).toBe('syncing');
    const answered = { ...edited, receipts: [...edited.receipts, receipt('e-edit', 'synced', 'accepted', '2026-11-12T00:00:00.000Z')] };
    expect(statusOf(records[0]!, answered)).toBe('synced');
  });

  it('a store with nothing to prune is returned as is', () => {
    const none = { events: [], mappings: [], receipts: [] };
    expect(pruneSettledReceipts(none)).toBe(none);
  });
});
