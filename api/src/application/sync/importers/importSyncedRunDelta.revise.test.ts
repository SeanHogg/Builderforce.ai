/**
 * PRD 41 §6 — the REVISION of a synced run delta (`update`): the final delta of a run whose L3 analyzers settled after
 * the static delta was stored. Evidence stays write-once (a new blob under the NEW digest; the old one is never
 * rewritten); the row's pointer moves to the new digest; only an imported delta can be revised, under the base-version
 * gate; a writer without `revise` keeps refusing (`run_delta_immutable`).
 */

import { describe, expect, it, vi } from 'vitest';
import type { RunDelta } from '@builderforce/run-delta';
import type { ImportedRunDelta } from '../../../domain/runDelta/runDeltaRecord';
import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import type { RunDeltaImportPorts } from '../../runDelta/runDeltaPorts';
import { ctx, event, mapping, stores } from './__fixtures__/importerHarness';
import { delta, ENTITY, payload } from './__fixtures__/runDeltaFixture';
import { importMirrorRecord } from './importMirrorRecord';

/** The final delta: the phase-1 one with its analyzer measured (a different digest). */
const revised = (): RunDelta => delta((d) => { d.dimensions[1]!.measuredBy = [{ tool: 'gitleaks', version: '8.18.4', status: 'ok' }]; });

function ports(opts: { missing?: boolean; noRevise?: boolean } = {}) {
  const puts: string[] = [];
  const revisedRows: ImportedRunDelta[] = [];
  const inserted: ImportedRunDelta[] = [];
  const invalidate = vi.fn(async () => undefined);
  const p: RunDeltaImportPorts = {
    writer: {
      insert: async (_t, _p, imported) => { inserted.push(imported); return { status: 'inserted' }; },
      ...(opts.noRevise ? {} : { revise: async (_t: number, _p: number | null, imported: ImportedRunDelta) => { revisedRows.push(imported); return opts.missing ? { status: 'missing' as const } : { status: 'revised' as const }; } }),
    },
    evidence: { put: async (_t, d) => { puts.push(d.digest); }, get: async () => null },
    invalidate,
  };
  return { p, puts, revisedRows, inserted, invalidate };
}

const update = (d: RunDelta, baseVersion = 1) => event({ entityType: 'run-delta', operation: 'update', payload: payload({}, d), clientEntityId: ENTITY, baseVersion });

describe('importSyncedRunDelta — a revision (update)', () => {
  it('writes the new evidence under the NEW digest, moves the row pointer to it, and bumps the mapping version', async () => {
    const { p, puts, revisedRows, inserted } = ports();
    const first = delta();
    const final = revised();
    expect(final.digest).not.toBe(first.digest);
    const c = ctx();
    const out = await importMirrorRecord(update(final), c, stores(mapping({ serverId: ENTITY, serverVersion: 1, payloadHash: hashSyncPayload(payload({}, first)) })), p);
    expect(out).toMatchObject({ status: 'applied', serverVersion: 2 });
    expect(puts).toEqual([final.digest]); // the superseded digest's evidence is never rewritten
    expect(revisedRows.map((r) => r.summary.digest)).toEqual([final.digest]);
    expect(inserted).toEqual([]);
  });

  it('a mapped delta with no row yet gets its first row from the revision', async () => {
    const { p, inserted } = ports({ missing: true });
    const out = await importMirrorRecord(update(revised()), ctx(), stores(mapping({ serverId: ENTITY, serverVersion: 1 })), p);
    expect(out).toMatchObject({ status: 'applied' });
    expect(inserted).toHaveLength(1);
  });

  it('the same revision again is the existing one; a stale base version is a conflict', async () => {
    const final = revised();
    const { p, puts } = ports();
    const same = mapping({ serverId: ENTITY, serverVersion: 2, payloadHash: hashSyncPayload(payload({}, final)) });
    expect(await importMirrorRecord(update(final, 2), ctx(), stores(same), p)).toMatchObject({ status: 'applied' });
    expect(puts).toEqual([]);
    const ahead = mapping({ serverId: ENTITY, serverVersion: 5 });
    expect((await importMirrorRecord(update(final, 1), ctx(), stores(ahead), p)).status).toBe('conflict');
  });

  it('refuses a revision of a delta never imported, without a base version, or when the writer cannot revise', async () => {
    expect(await importMirrorRecord(update(revised()), ctx(), stores(), ports().p)).toEqual({ status: 'rejected', detail: 'run_delta_immutable' });
    const noBase = event({ entityType: 'run-delta', operation: 'update', payload: payload({}, revised()), clientEntityId: ENTITY });
    expect(await importMirrorRecord(noBase, ctx(), stores(mapping({ serverId: ENTITY })), ports().p)).toEqual({ status: 'rejected', detail: 'base_version_required' });
    expect(await importMirrorRecord(update(revised()), ctx(), stores(mapping({ serverId: ENTITY, serverVersion: 1 })), ports({ noRevise: true }).p))
      .toEqual({ status: 'rejected', detail: 'run_delta_immutable' });
  });

  it('refuses a revision whose digest is not its recomputed one (it keys the evidence)', async () => {
    const forged = { ...revised(), digest: 'f'.repeat(64) };
    expect(await importMirrorRecord(update(forged), ctx(), stores(mapping({ serverId: ENTITY, serverVersion: 1 })), ports().p))
      .toEqual({ status: 'rejected', detail: 'run_delta_digest_mismatch' });
  });
});
