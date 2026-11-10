import { describe, expect, it } from 'vitest';
import { hashSyncPayload } from '../../domain/sync/syncProtocol';
import { labelPrecedenceOf, labelSupersedes } from '../../domain/runOutcomes/runOutcomePolicy';
import type { ParsedLabel, ParsedRunOutcome } from '../../domain/runOutcomes/runOutcomeRecord';
import { ctx, event, mapping, stores } from '../sync/importers/__fixtures__/importerHarness';
import { DIGEST, features, gateLedgerRow, label, RECORD_ID, record } from '../../domain/runOutcomes/__fixtures__/runOutcomeRecord';
import { importSyncedRunOutcome, type SyncRunOutcomeStore } from './importSyncedRunOutcome';

/**
 * An in-memory run-outcomes store holding the same rules as the real one: features frozen
 * (first digest wins, a different one is refused), labels kept by `labelSupersedes`.
 */
function memoryStore() {
  const features = new Map<string, string>();
  const labels = new Map<string, ParsedLabel>();
  const writes: Array<{ tenantId: number; projectId: number | null; record: ParsedRunOutcome }> = [];
  const store: SyncRunOutcomeStore = {
    async write(tenantId, projectId, rec) {
      writes.push({ tenantId, projectId, record: rec });
      const key = `${tenantId}:${rec.runId}:${rec.repository}`;
      const digest = features.get(key);
      if (digest !== undefined && digest !== rec.features.digest) return { ok: false, detail: 'run_features_frozen' };
      if (digest === undefined) features.set(key, rec.features.digest);
      for (const l of rec.labels) {
        const lk = `${key}:${l.kind}`;
        const stored = labels.get(lk);
        if (labelSupersedes(stored && labelPrecedenceOf(stored), labelPrecedenceOf(l))) labels.set(lk, l);
      }
      return { ok: true };
    },
  };
  return { store, writes, features, labels };
}

const send = (operation: 'create' | 'import' | 'update' | 'delete', payload: unknown = record(), baseVersion?: number) =>
  event({ entityType: 'run-outcome', operation, payload, clientEntityId: RECORD_ID, ...(baseVersion !== undefined ? { baseVersion } : {}) });

describe('importSyncedRunOutcome', () => {
  it('imports a new record: features, attributions and labels, mapped under its record id', async () => {
    const mem = memoryStore();
    const outcome = await importSyncedRunOutcome(send('create'), ctx(), stores(), mem.store);
    expect(outcome).toMatchObject({ status: 'applied', serverId: RECORD_ID, serverVersion: 1 });
    expect(mem.writes).toHaveLength(1);
    expect(mem.writes[0]).toMatchObject({ tenantId: 7, projectId: null });
    expect(mem.writes[0]!.record.attributions).toHaveLength(1);
  });

  it('refuses the gate-ledger-shaped payload and writes nothing', async () => {
    const mem = memoryStore();
    const outcome = await importSyncedRunOutcome(send('create', gateLedgerRow), ctx(), stores(), mem.store);
    expect(outcome).toEqual({ status: 'rejected', detail: 'run_outcome_not_a_record' });
    expect(mem.writes).toHaveLength(0);
  });

  it('never overwrites frozen features: a different digest for the same run is a conflict', async () => {
    const mem = memoryStore();
    const first = record();
    await importSyncedRunOutcome(send('create', first), ctx(), stores(), mem.store);
    const changed = record({ features: features({ values: { 'size.linesAdded': 99 } }) });
    const current = mapping({ serverId: RECORD_ID, serverVersion: 1, payloadHash: hashSyncPayload(first) });
    const outcome = await importSyncedRunOutcome(send('update', changed, 1), ctx(), stores(current), mem.store);
    expect(outcome).toMatchObject({ status: 'conflict', detail: 'run_features_frozen' });
    expect([...mem.features.values()]).toEqual([DIGEST]);
  });

  it('refuses a vector whose digest the server does not recompute, and an unknown feature id', async () => {
    const mem = memoryStore();
    const forged = record({ features: features({ digest: 'b'.repeat(64) }) });
    expect(await importSyncedRunOutcome(send('create', forged), ctx(), stores(), mem.store))
      .toEqual({ status: 'rejected', detail: 'run_features_digest_mismatch' });
    const smuggled = record({ features: features({ values: { 'size.linesAdded': 1, 'tenant.secret': 7 } }) });
    expect(await importSyncedRunOutcome(send('create', smuggled), ctx(), stores(), mem.store))
      .toEqual({ status: 'rejected', detail: 'run_features_value_id_unknown' });
    expect(mem.writes).toHaveLength(0);
  });

  it('applies an update that grows the labels, versioned past the mapping', async () => {
    const mem = memoryStore();
    const first = record();
    await importSyncedRunOutcome(send('create', first), ctx(), stores(), mem.store);
    const grown = record({ labels: [label({ status: 'final', value: true, eventAt: '2026-10-11T00:00:00.000Z', computedAt: '2026-10-15T00:00:00.000Z' })] });
    const current = mapping({ serverId: RECORD_ID, serverVersion: 1, payloadHash: hashSyncPayload(first) });
    const outcome = await importSyncedRunOutcome(send('update', grown, 1), ctx(), stores(current), mem.store);
    expect(outcome).toMatchObject({ status: 'applied', serverId: RECORD_ID, serverVersion: 2 });
    expect([...mem.labels.values()][0]).toMatchObject({ status: 'final', value: true });
  });

  it('label upsert precedence: a later censored label never reopens a final one', async () => {
    const mem = memoryStore();
    const finalLabel = record({ labels: [label({ status: 'final', value: false, computedAt: '2026-10-15T00:00:00.000Z' })] });
    await importSyncedRunOutcome(send('create', finalLabel), ctx(), stores(), mem.store);
    const reopened = record({ labels: [label({ status: 'censored', value: null, computedAt: '2026-10-17T00:00:00.000Z' })] });
    const current = mapping({ serverId: RECORD_ID, serverVersion: 1, payloadHash: hashSyncPayload(finalLabel) });
    await importSyncedRunOutcome(send('update', reopened, 1), ctx(), stores(current), mem.store);
    expect([...mem.labels.values()][0]).toMatchObject({ status: 'final', value: false });
  });

  it('replays an identical event without a write', async () => {
    const mem = memoryStore();
    const body = record();
    const current = mapping({ serverId: RECORD_ID, serverVersion: 1, payloadHash: hashSyncPayload(body) });
    const outcome = await importSyncedRunOutcome(send('create', body), ctx(), stores(current), mem.store);
    expect(outcome).toMatchObject({ status: 'applied', serverVersion: 1 });
    expect(mem.writes).toHaveLength(0);
  });

  it('refuses a delete: a device dropping its record does not erase training data', async () => {
    const mem = memoryStore();
    const outcome = await importSyncedRunOutcome(send('delete', null, 1), ctx(), stores(mapping()), mem.store);
    expect(outcome).toEqual({ status: 'rejected', detail: 'run_outcome_delete_unsupported' });
  });

  it('answers a failed write pending, so the event is retried', async () => {
    const failing: SyncRunOutcomeStore = { write: async () => { throw new Error('ops down'); } };
    const outcome = await importSyncedRunOutcome(send('create'), ctx(), stores(), failing);
    expect(outcome).toEqual({ status: 'pending', detail: 'run_outcome_write_failed' });
  });
});
