/**
 * PRD 41 §12.5: an autonomous run held at its finalize gate syncs as an `execution` mirror record — `awaiting_input` with
 * its `hold`, then `completed` with the `waiver` of a person's release. The mirror importer accepts both (no status
 * vocabulary of its own), so neither is rejected or dead-lettered.
 */
import { describe, expect, it } from 'vitest';
import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import { ctx, event, mapping, stores } from './__fixtures__/importerHarness';
import { importMirrorRecord } from './importMirrorRecord';

const hold = { reason: 'run_delta_blocking:guard-removed', rules: ['guard-removed'] };
const waiver = { by: 'user-42', at: '2026-11-10T12:00:00.000Z', rules: ['guard-removed'] };

describe('execution mirror: held and released runs (PRD 41 §12.5)', () => {
  it('imports a held run (awaiting_input + hold), and an unmeasured one', async () => {
    for (const payload of [
      { chatId: '7', status: 'awaiting_input', hold },
      { chatId: '7', status: 'awaiting_input', hold: { reason: 'run_delta_unmeasured', rules: [] } },
    ]) {
      const outcome = await importMirrorRecord(event({ entityType: 'execution', operation: 'import', payload }), ctx(), stores());
      expect(outcome.status).toBe('applied');
      if (outcome.status === 'applied') expect(outcome.payload).toEqual(payload);
    }
  });

  it('applies the hold, then the release (completed + waiver), as updates on the imported run', async () => {
    const held = { status: 'awaiting_input', hold };
    const onHeld = await importMirrorRecord(
      event({ entityType: 'execution', operation: 'update', baseVersion: 2, payload: held }),
      ctx(),
      stores(mapping({ serverVersion: 2 })),
    );
    expect(onHeld).toMatchObject({ status: 'applied', serverVersion: 3 });
    const released = { status: 'completed', waiver };
    const onReleased = await importMirrorRecord(
      event({ entityType: 'execution', operation: 'update', baseVersion: 3, payload: released }),
      ctx(),
      stores(mapping({ serverVersion: 3, payloadHash: hashSyncPayload(held) })),
    );
    expect(onReleased).toMatchObject({ status: 'applied', serverVersion: 4, payload: released });
  });
});
