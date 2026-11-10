/**
 * PRD 41 §6 — a run delta's REVISION through the REAL push: the VSIX stores the static delta (`create`), then, when its
 * L3 analyzers settle, the final delta as an `update` (`reviseRunDelta`, `dependsOn` the create, base version 1). The
 * envelope, the mirror importer's revision branch, the rows (pointer moved), the evidence (one blob per digest) and the
 * projection (the final payload) are all exercised.
 */

import { describe, expect, it } from 'vitest';
import { SYNC_PROTOCOL_VERSION, hashSyncPayload, type EntityDestination } from '../../domain/sync/syncProtocol';
import type { ImportedRunDelta } from '../../domain/runDelta/runDeltaRecord';
import { createMemorySyncStores } from './__fixtures__/memorySyncStores';
import { handleSyncPush } from './handleSyncPush';
import { importMirrorRecord } from './importers/importMirrorRecord';
import { delta, ENTITY, payload } from './importers/__fixtures__/runDeltaFixture';
import type { RunDeltaImportPorts } from '../runDelta/runDeltaPorts';
import type { SyncNamedImporters } from './syncPorts';

const NOW = new Date('2026-02-01T10:00:00.000Z');
const DESTINATION: EntityDestination = { kind: 'bound', tenantId: '7', accountId: 'user-7' };
const AUTH = { tenantId: 7, userId: 'user-7', role: 'developer' };

function harness() {
  const inserted: ImportedRunDelta[] = [];
  const revised: ImportedRunDelta[] = [];
  const blobs: string[] = [];
  const ports: RunDeltaImportPorts = {
    writer: {
      insert: async (_t, _p, imported) => { inserted.push(imported); return { status: 'inserted' }; },
      revise: async (_t, _p, imported) => { revised.push(imported); return { status: 'revised' }; },
    },
    evidence: { put: async (_t, d) => { blobs.push(d.digest); }, get: async () => null },
    invalidate: async () => undefined,
  };
  const refuse = async () => ({ status: 'rejected' as const, detail: 'not_under_test' });
  const importers: SyncNamedImporters = {
    importSyncedTicket: refuse, importSyncedProject: refuse, importSyncedChat: refuse, importSyncedMessage: refuse,
    importSyncedUsage: refuse, importSyncedChatTicketLink: refuse,
    importMirrorRecord: (event, ctx, stores) => importMirrorRecord(event, ctx, stores, ports),
  };
  const stores = createMemorySyncStores({ importers, references: { projectInTenant: async () => true }, now: () => NOW });
  return { inserted, revised, blobs, stores, push: (body: unknown) => handleSyncPush(body, { auth: AUTH, now: NOW, stores }) };
}

const eventOf = (operation: 'create' | 'update', body: unknown, eventId: string, extra: Record<string, unknown> = {}) => ({
  eventId, clientEntityId: ENTITY, entityType: 'run-delta', operation, schemaVersion: 1, localSequence: operation === 'create' ? 1 : 2,
  occurredAt: '2026-01-31T08:00:00.000Z', dependsOn: [], destination: DESTINATION, payload: body, payloadHash: hashSyncPayload(body), ...extra,
});
const batch = (id: string, events: unknown[]) => ({ batchId: id, protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: 'device-a', destination: DESTINATION, events });

describe('handleSyncPush — a run delta revised by its L3 phase', () => {
  it('accepts the update of an imported delta: new evidence under the new digest, the row pointer moved, the projection final', async () => {
    const h = harness();
    const first = delta();
    const final = delta((d) => { d.dimensions[1]!.measuredBy = [{ tool: 'gitleaks', version: '8.18.4', status: 'ok' }]; });
    const created = await h.push(batch('b-1', [eventOf('create', payload({}, first), '11111111-1111-4111-8111-111111111111')]));
    expect(created.ok && created.receipts.map((r) => r.status)).toEqual(['accepted']);
    const finalPayload = payload({}, final);
    const updated = await h.push(batch('b-2', [eventOf('update', finalPayload, '33333333-3333-4333-8333-333333333333', { baseVersion: 1 })]));
    expect(updated.ok && updated.receipts.map((r) => r.status)).toEqual(['accepted']);
    expect(h.inserted.map((i) => i.summary.digest)).toEqual([first.digest]);
    expect(h.revised.map((i) => i.summary.digest)).toEqual([final.digest]);
    expect(h.blobs).toEqual([first.digest, final.digest]);
    const record = h.stores.state().records.find((r) => r.clientEntityId === ENTITY)!;
    expect(record.payload).toEqual(finalPayload);
  });
});
