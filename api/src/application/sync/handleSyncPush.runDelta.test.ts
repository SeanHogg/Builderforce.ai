/**
 * PRD 41 §C14 (review C1) — a `run-delta` record goes through the REAL push end to end: the envelope (which accepts
 * only UUID client ids — the reason the client derives the id with `stableEntityId`), the mirror importer's
 * run-delta branch, the rows, the projection and the receipt. The VSIX's old `run-delta:<run>:<repo>` id is refused
 * by the envelope, which is the failure this pins.
 */

import { describe, expect, it } from 'vitest';
import { stableEntityId } from '@builderforce/local-first';
import { SYNC_PROTOCOL_VERSION, hashSyncPayload, type EntityDestination } from '../../domain/sync/syncProtocol';
import type { ImportedRunDelta } from '../../domain/runDelta/runDeltaRecord';
import { createMemorySyncStores } from './__fixtures__/memorySyncStores';
import { handleSyncPush } from './handleSyncPush';
import { importMirrorRecord } from './importers/importMirrorRecord';
import { ENTITY, payload, REPO_KEY, RUN_ID } from './importers/__fixtures__/runDeltaFixture';
import type { RunDeltaImportPorts } from '../runDelta/runDeltaPorts';
import type { SyncNamedImporters } from './syncPorts';

const NOW = new Date('2026-02-01T10:00:00.000Z');
const DESTINATION: EntityDestination = { kind: 'bound', tenantId: '7', accountId: 'user-7' };
const AUTH = { tenantId: 7, userId: 'user-7', role: 'developer' };

function harness() {
  const inserted: Array<{ projectId: number | null; imported: ImportedRunDelta }> = [];
  const blobs: string[] = [];
  const ports: RunDeltaImportPorts = {
    writer: { insert: async (_tenant, projectId, imported) => { inserted.push({ projectId, imported }); return { status: 'inserted' }; } },
    evidence: { put: async (_tenant, delta) => { blobs.push(delta.digest); }, get: async () => null },
    invalidate: async () => undefined,
  };
  const refuse = async () => ({ status: 'rejected' as const, detail: 'not_under_test' });
  const importers: SyncNamedImporters = {
    importSyncedTicket: refuse, importSyncedProject: refuse, importSyncedChat: refuse, importSyncedMessage: refuse,
    importSyncedUsage: refuse, importSyncedChatTicketLink: refuse,
    importMirrorRecord: (event, ctx, stores) => importMirrorRecord(event, ctx, stores, ports),
  };
  const stores = createMemorySyncStores({ importers, references: { projectInTenant: async (_t, id) => id === 5 }, now: () => NOW });
  return { inserted, blobs, stores, push: (body: unknown) => handleSyncPush(body, { auth: AUTH, now: NOW, stores }) };
}

const eventOf = (clientEntityId: string, body: unknown, eventId: string) => ({
  eventId, clientEntityId, entityType: 'run-delta', operation: 'create', schemaVersion: 1, localSequence: 1,
  occurredAt: '2026-01-31T08:00:00.000Z', dependsOn: [], destination: DESTINATION, payload: body, payloadHash: hashSyncPayload(body),
});
const batch = (events: unknown[]) => ({ batchId: 'b-1', protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: 'device-a', destination: DESTINATION, events });

describe('handleSyncPush — run-delta end to end', () => {
  it('accepts a delta under its stableEntityId, writes its rows with the payload\'s project, and projects it', async () => {
    const h = harness();
    expect(ENTITY).toBe(stableEntityId(`run-delta:${RUN_ID}:${REPO_KEY}`));
    const response = await h.push(batch([eventOf(ENTITY, payload({ projectId: 5 }), '11111111-1111-4111-8111-111111111111')]));
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.receipts.map((r) => r.status)).toEqual(['accepted']);
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]).toMatchObject({ projectId: 5, imported: { summary: { runId: RUN_ID, repoKey: REPO_KEY } } });
    expect(h.blobs).toEqual([h.inserted[0]!.imported.delta.digest]);
    expect(h.stores.state().records.map((r) => r.clientEntityId)).toEqual([ENTITY]);
  });

  it('refuses the old composite id at the envelope, so nothing is written', async () => {
    const h = harness();
    const response = await h.push(batch([eventOf(`run-delta:${RUN_ID}:${REPO_KEY}`, payload(), '22222222-2222-4222-8222-222222222222')]));
    // The batch is well-formed; the ONE event is refused, with the envelope's reason.
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.receipts).toEqual([expect.objectContaining({ status: 'rejected', detail: 'event_id_invalid' })]);
    expect(h.inserted).toHaveLength(0);
    expect(h.stores.state().records).toEqual([]);
  });
});
