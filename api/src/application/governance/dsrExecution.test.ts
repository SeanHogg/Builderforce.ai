import { describe, expect, it, vi } from 'vitest';

vi.mock('./mutationAudit', () => ({ recordGovernanceMutation: vi.fn(async () => undefined) }));

import { dsrDisposition, executeDataSubjectRequest, markDsrDelivered, projectDsrRow } from './dsrExecution';

const actor = { type: 'human' as const, ref: 'u1', name: 'Ada' };
const scope = { tenantId: 1, segmentId: 'seg' };

/** A db that returns one DSR row from select, and records the update. */
function fakeDb(dsr: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (dsr ? [dsr] : []) }) }) }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: () => ({ returning: async () => { updates.push(v); return [{ ...dsr, ...v }]; } }) }) }),
    execute: async () => ({ rows: [{ id: 'sup' }] }),
  };
  return { db: db as never, updates };
}

const base = { id: 'd1', requestType: 'access', subjectEmail: 'A@x.com', status: 'pending', verifiedAt: null, executionResult: null };

describe('executing a data subject request', () => {
  it('REFUSES when verifiedAt is null, whatever the status says', async () => {
    for (const status of ['pending', 'processing', 'verifying_identity']) {
      const { db, updates } = fakeDb({ ...base, status });
      const out = await executeDataSubjectRequest(undefined, db, scope, 'd1', actor);
      expect(out).toMatchObject({ ok: false, status: 409 });
      expect(updates).toHaveLength(0);
    }
  });

  it('an access request is prepared, persisted and left PROCESSING - never auto-completed', async () => {
    const { db, updates } = fakeDb({ ...base, verifiedAt: new Date() });
    const persistExport = vi.fn(async () => '1/u1/file.json');
    const out = await executeDataSubjectRequest(undefined, db, scope, 'd1', actor, { stores: [], persistExport });
    expect(persistExport).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ ok: true, result: { status: 'processing', exportKey: '1/u1/file.json' } });
    if (out.ok) expect(out.result.outstanding).toEqual(expect.arrayContaining(['marketing_audience_members', 'candidate_records']));
    expect(updates[0]).toMatchObject({ status: 'processing', processedAt: null });
  });

  it('records that the export file could not be stored rather than claiming it was', async () => {
    const { db } = fakeDb({ ...base, verifiedAt: new Date() });
    const out = await executeDataSubjectRequest(undefined, db, scope, 'd1', actor, { stores: [], persistExport: async () => null });
    expect(out.ok && out.result.exportKey).toBeNull();
    expect(out.ok && out.result.outstanding).toContain('export_file_storage');
  });

  it('only a separate "mark delivered" completes an export, and only after it was executed', async () => {
    const never = fakeDb({ ...base, verifiedAt: new Date(), executionResult: null });
    expect(await markDsrDelivered(undefined, never.db, scope, 'd1', actor)).toMatchObject({ ok: false, status: 409 });

    const executed = fakeDb({
      ...base, verifiedAt: new Date(), status: 'processing',
      executionResult: JSON.stringify({ status: 'processing', disposition: 'export', exportKey: 'k', outstanding: [], deliveredAt: null }),
    });
    const out = await markDsrDelivered(undefined, executed.db, scope, 'd1', actor);
    expect(out).toMatchObject({ ok: true, result: { status: 'completed' } });
    expect(executed.updates[0]).toMatchObject({ status: 'completed' });
  });

  it('the tracker list never returns the storage key: executionResult goes out in the public shape', () => {
    const stored = JSON.stringify({ status: 'processing', disposition: 'export', exportKey: '1/private/dsr/secret.json', outstanding: [] });
    const row = projectDsrRow({ id: 'd1', subjectEmail: 'a@x.com', executionResult: stored });
    const text = JSON.stringify(row);
    expect(text).not.toContain('1/private/dsr/secret.json');
    expect(text).not.toContain('exportKey');
    expect(JSON.parse(row.executionResult as string)).toMatchObject({ exportUrl: '/api/governance/dsr/d1/export', disposition: 'export' });
  });

  it('a request with no execution, or an unreadable one, is returned without leaking anything', () => {
    expect(projectDsrRow({ id: 'd1', executionResult: null })).toEqual({ id: 'd1', executionResult: null });
    expect(projectDsrRow({ id: 'd1', executionResult: 'not json 1/private/x' }).executionResult).toBeNull();
    expect(projectDsrRow({ id: 'd1', executionResult: JSON.stringify({ status: 'processing', exportKey: null }) }).executionResult)
      .toContain('"exportUrl":null');
  });

  it('knows what each request type does (the API owns the answer)', () => {
    expect(dsrDisposition('portability')).toBe('export');
    expect(dsrDisposition('erasure')).toBe('suppress_and_erase');
    expect(dsrDisposition('opt_out')).toBe('suppress');
    expect(dsrDisposition('rectification')).toBe('manual');
  });
});
