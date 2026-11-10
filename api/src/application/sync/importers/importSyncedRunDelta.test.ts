/**
 * PRD 41 §C14 — the `run-delta` mirror lands as rows. Pins: the payload is validated (never truncated into a
 * different delta) and run / repo key / project are read from the payload under the id they name; the digest is
 * recomputed; the evidence blob is written before the rows and a failed blob is RETRIED (pending); an
 * already-mapped event writes nothing; an update is refused (deltas are immutable); a newer client's delta is held;
 * a row the database refuses is rejected, never a wedged chunk; the read caches are bumped after commit.
 * One `regression:` test per storability hole the review found (H1, M1, M2, L1, L3).
 */

import { describe, expect, it, vi } from 'vitest';
import { findingCardText, readRunDeltaRecord, runDeltaClientId, type ImportedRunDelta } from '../../../domain/runDelta/runDeltaRecord';
import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import type { RunDeltaImportPorts, RunDeltaWriter } from '../../runDelta/runDeltaPorts';
import { ctx, event, mapping, now, stores } from './__fixtures__/importerHarness';
import { delta, ENTITY, finding, payload, REPO_KEY, RUN_ID } from './__fixtures__/runDeltaFixture';
import { importMirrorRecord } from './importMirrorRecord';

const clamp = (raw: unknown): Date => {
  const at = typeof raw === 'string' ? new Date(raw) : null;
  return !at || Number.isNaN(at.getTime()) || at > now ? now : at;
};
const read = (p: unknown, id = ENTITY) => readRunDeltaRecord(p, id, '2026-01-01T00:00:00.000Z', clamp);

function ports(opts: { putFails?: boolean; insert?: RunDeltaWriter['insert'] } = {}) {
  const inserted: Array<{ tenantId: number; projectId: number | null; imported: ImportedRunDelta }> = [];
  const put = vi.fn(async () => { if (opts.putFails) throw new Error('r2 down'); });
  const invalidate = vi.fn(async () => undefined);
  const p: RunDeltaImportPorts = {
    writer: {
      insert: opts.insert ?? (async (tenantId, projectId, imported) => { inserted.push({ tenantId, projectId, imported }); return { status: 'inserted' }; }),
    },
    evidence: { put, get: async () => null },
    invalidate,
  };
  return { p, inserted, put, invalidate };
}

const create = (p: unknown = payload()) => event({ entityType: 'run-delta', operation: 'create', payload: p, clientEntityId: ENTITY });
const pgError = (code: string) => Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('pg'), { code }) });

describe('readRunDeltaRecord', () => {
  it('reads run, repo key and project from the payload under the id they name, and reduces the delta to rows', () => {
    const parsed = read(payload({ projectId: 9, computedAt: '2026-01-01T10:00:00Z' }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const v = parsed.value;
    expect(v.summary).toMatchObject({ runId: RUN_ID, repoKey: REPO_KEY, surface: 'vscode', mode: 'autonomous', computedAt: '2026-01-01T10:00:00.000Z', counts: { introduced: 1, resolved: 1 } });
    expect(v.projectRef).toBe('9');
    expect(v.dimensions).toEqual([
      { dimensionId: 'quality', verdict: 'better', introduced: 0, resolved: 1, changed: 0 },
      { dimensionId: 'security', verdict: 'worse', introduced: 1, resolved: 0, changed: 1 },
    ]);
    expect(v.findings.map((f) => [f.ruleId, f.lineage, f.dimensionId])).toEqual([
      ['test-skipped', 'resolved', 'quality'], ['guard-removed', 'introduced', 'security'], ['weak-crypto', 'changed', 'security'],
    ]);
  });

  it('regression: an id that is not the one the payload names is refused (no replay under another key)', () => {
    expect(read(payload(), runDeltaClientId('other', REPO_KEY))).toEqual({ ok: false, detail: 'run_delta_id_mismatch' });
    expect(read(payload({ repoKey: undefined }))).toEqual({ ok: false, detail: 'run_delta_key_invalid' });
  });

  it('card text: rule + params, anchor, the normalized snippet and the evidence summary — re-redacted', () => {
    expect(findingCardText(finding('guard-removed', 'introduced'))).toBe(
      'guard-removed (route=POST /x)\nguard-removed@1:file:src/a.ts#k\nrouter.post( "/x" ,\nh )\nafter src/a.ts:7',
    );
    const secret = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
    const card = findingCardText(finding('secret-added', 'introduced', { evidence: [{ side: 'after', path: 'a.ts', snippet: `token = "${secret}"` }] }));
    expect(card).not.toContain(secret);
  });

  it('regression (L1): a future computedAt is clamped to now, like occurredAt', () => {
    const parsed = read(payload({ computedAt: '2999-01-01T00:00:00Z' }));
    expect(parsed.ok && parsed.value.summary.computedAt).toBe(now.toISOString());
  });

  it('regression (M1): a client digest that is not the recomputed one is refused (it keys the evidence blob)', () => {
    expect(read(payload({}, { ...delta(), digest: 'f'.repeat(64) }))).toEqual({ ok: false, detail: 'run_delta_digest_mismatch' });
  });

  it('regression (M2): a newer version is held (retry); a malformed version is refused', () => {
    expect(read(payload({}, { ...delta(), version: 2 as 1 }))).toEqual({ ok: false, detail: 'run_delta_version_unsupported', retry: true });
    expect(read(payload({}, { ...delta(), version: 'x' as unknown as 1 }))).toEqual({ ok: false, detail: 'run_delta_version_invalid' });
  });

  describe('regression (H1): what passes validation is storable', () => {
    const withFinding = (extra: Partial<ReturnType<typeof finding>>) =>
      read(payload({}, delta((d) => { d.dimensions[1]!.findings = [finding('guard-removed', 'introduced', extra)]; })));

    it('a null evidence item', () => {
      expect(withFinding({ evidence: [null as never] })).toEqual({ ok: false, detail: 'run_delta_invalid' });
    });
    it('an evidence item with a non-string path', () => {
      expect(withFinding({ evidence: [{ side: 'after', path: 7 as never }] })).toEqual({ ok: false, detail: 'run_delta_invalid' });
    });
    it('a ruleVersion outside int4', () => {
      expect(withFinding({ ruleVersion: 2 ** 31 })).toEqual({ ok: false, detail: 'run_delta_invalid' });
    });
    it('duplicate dimension ids (the primary key)', () => {
      expect(read(payload({}, delta((d) => { d.dimensions[0]!.id = 'security'; })))).toEqual({ ok: false, detail: 'run_delta_dimension_duplicate' });
    });
    it('U+0000 in a snippet (card text) or in the summary', () => {
      expect(withFinding({ evidence: [{ side: 'after', path: 'a.ts', snippet: 'a\u0000b' }] })).toEqual({ ok: false, detail: 'run_delta_invalid' });
      expect(read(payload({}, delta((d) => { d.summary = { ...d.summary, clauses: [{ dimension: 'security', verdict: 'worse', code: 'x\u0000', count: 1 }] }; }))))
        .toEqual({ ok: false, detail: 'run_delta_invalid' });
    });
    it('an anchor over 1024 bytes (indexed directly) is refused; a long identity id is kept, keyed by its hash', () => {
      const long = 'é'.repeat(600); // 1200 bytes, 600 characters
      expect(withFinding({ identity: { id: 'i', anchor: long, anchorKind: 'file', members: [] } })).toEqual({ ok: false, detail: 'run_delta_invalid' });
      const many = read(payload({}, delta((d) => {
        d.dimensions[1]!.findings = [finding('guard-removed', 'introduced', { identity: { id: long, anchor: 'a', anchorKind: 'file', members: [] } })];
      })));
      expect(many.ok).toBe(true);
      if (!many.ok) return;
      const row = many.value.findings.find((f) => f.identityId === long);
      expect(row?.identityHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});

describe('importMirrorRecord — run-delta (bound)', () => {
  it('writes the evidence, then the rows, and bumps the read caches after commit', async () => {
    const { p, inserted, put, invalidate } = ports();
    const effects: Array<() => Promise<unknown>> = [];
    const outcome = await importMirrorRecord(create(payload({ projectId: '5' })), ctx({ afterCommit: (e) => effects.push(e) }), stores(), p);
    expect(outcome).toMatchObject({ status: 'applied', serverId: ENTITY, serverVersion: 1 });
    expect(put).toHaveBeenCalledWith(7, expect.objectContaining({ digest: delta().digest }));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ tenantId: 7, projectId: 3 });
    expect(invalidate).not.toHaveBeenCalled();
    await Promise.all(effects.map((e) => e()));
    expect(invalidate).toHaveBeenCalledWith(7);
  });

  it('answers pending (retried) and writes no row when the evidence blob fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { p, inserted } = ports({ putFails: true });
    expect(await importMirrorRecord(create(), ctx(), stores(), p)).toEqual({ status: 'pending', detail: 'run_delta_evidence_write_failed' });
    expect(inserted).toHaveLength(0);
  });

  it('regression (M2): holds a newer client\'s delta pending without writing anything', async () => {
    const { p, put } = ports();
    expect(await importMirrorRecord(create(payload({}, { ...delta(), version: 2 as 1 })), ctx(), stores(), p))
      .toEqual({ status: 'pending', detail: 'run_delta_version_unsupported' });
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps the delta but drops a project the caller cannot use', async () => {
    const { p, inserted } = ports();
    const outcome = await importMirrorRecord(create(payload({ projectId: '99' })), ctx({ resolveProjectId: async () => null }), stores(), p);
    expect(outcome).toMatchObject({ status: 'applied', detail: 'project_unresolved' });
    expect(inserted[0]?.projectId).toBeNull();
  });

  it('a replay of an imported event writes nothing', async () => {
    const { p, inserted, put } = ports();
    const outcome = await importMirrorRecord(create(), ctx(), stores(mapping({ payloadHash: hashSyncPayload(payload()) })), p);
    expect(outcome).toMatchObject({ status: 'applied' });
    expect(put).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('refuses an update (a computed delta does not change) and an invalid payload', async () => {
    const { p, inserted } = ports();
    expect(await importMirrorRecord(event({ entityType: 'run-delta', operation: 'update', payload: payload(), clientEntityId: ENTITY }), ctx(), stores(), p))
      .toEqual({ status: 'rejected', detail: 'run_delta_immutable' });
    expect(await importMirrorRecord(create({ ...payload(), delta: null }), ctx(), stores(), p)).toEqual({ status: 'rejected', detail: 'run_delta_invalid' });
    expect(inserted).toHaveLength(0);
  });

  it('regression: U+0000 anywhere in the payload (even a field no row reads) is refused before sync_records sees it', async () => {
    const { p, inserted, put } = ports();
    expect(await importMirrorRecord(create(payload({ overridesDropped: ['x\u0000y'] })), ctx(), stores(), p))
      .toEqual({ status: 'rejected', detail: 'run_delta_payload_nul' });
    expect(put).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('regression (H1 backstop): a 22xxx / 23xxx the database still raises is rejected, never a wedged chunk', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const code of ['22P05', '23505', '22001']) {
      const { p } = ports({ insert: async () => { throw pgError(code); } });
      expect(await importMirrorRecord(create(), ctx(), stores(), p), code).toEqual({ status: 'rejected', detail: 'run_delta_unstorable' });
    }
    // Anything else (a dropped connection) is NOT a verdict on the delta: it propagates, so the push retries.
    const { p } = ports({ insert: async () => { throw pgError('08006'); } });
    await expect(importMirrorRecord(create(), ctx(), stores(), p)).rejects.toThrow();
  });

  it('regression (L3): an already stored (run, repo key) is the same delta or a conflict, never a second applied write', async () => {
    const same = ports({ insert: async () => ({ status: 'exists', digest: delta().digest }) });
    const fx = vi.fn();
    expect(await importMirrorRecord(create(), ctx({ afterCommit: fx }), stores(), same.p)).toMatchObject({ status: 'applied' });
    expect(fx).not.toHaveBeenCalled();
    const other = ports({ insert: async () => ({ status: 'exists', digest: 'e'.repeat(64) }) });
    expect(await importMirrorRecord(create(), ctx(), stores(), other.p)).toMatchObject({ status: 'conflict', detail: 'run_delta_already_stored' });
  });
});
