import { describe, expect, it } from 'vitest';
import { isPrivacyRequestStatus, isPrivacyRequestType, listPrivacyRequests, updatePrivacyRequest } from './privacyRequests';

/** Records the chain a query was built with; the terminal call resolves to `rows`. */
function recordingDb(rows: unknown[] = []) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'update', 'set']) {
    chain[m] = (...args: unknown[]) => { calls[m] = args; return chain; };
  }
  chain.limit = (...args: unknown[]) => { calls.limit = args; return Promise.resolve(rows); };
  chain.returning = () => Promise.resolve(rows);
  return { db: chain as never, calls };
}

describe('privacy-request vocabularies', () => {
  it('know the whole enum, not the old two-type / three-status console subset', () => {
    expect(isPrivacyRequestType('deletion')).toBe(true);
    expect(isPrivacyRequestType('gdpr')).toBe(true);
    expect(isPrivacyRequestType('nope')).toBe(false);
    expect(isPrivacyRequestStatus('processing')).toBe(true);
    expect(isPrivacyRequestStatus('appealed')).toBe(true);
    expect(isPrivacyRequestStatus('done')).toBe(false);
  });
});

describe('listPrivacyRequests — one list, two scopes', () => {
  it('subject scope: the person\'s own rows, capped', async () => {
    const { db, calls } = recordingDb([{ id: 1 }]);
    expect(await listPrivacyRequests(db, { kind: 'subject', userId: 'u1' as never })).toEqual([{ id: 1 }]);
    expect(calls.where?.[0]).toBeDefined();
    expect(calls.limit?.[0]).toBeGreaterThan(0);
  });

  it('admin scope: unfiltered when no filter is valid, limit clamped to 1000', async () => {
    const { db, calls } = recordingDb();
    await listPrivacyRequests(db, { kind: 'platform_admin', status: 'bogus', type: 'bogus', q: '  ', limit: 50_000 });
    expect(calls.where?.[0]).toBeUndefined();
    expect(calls.limit?.[0]).toBe(1000);
  });

  it('admin scope: a valid filter narrows the query', async () => {
    const { db, calls } = recordingDb();
    await listPrivacyRequests(db, { kind: 'platform_admin', status: 'processing', limit: 200 });
    expect(calls.where?.[0]).toBeDefined();
    expect(calls.limit?.[0]).toBe(200);
  });
});

describe('updatePrivacyRequest — the fulfilment step', () => {
  it('a terminal status stamps closedAt; the resolution is trimmed', async () => {
    const { db, calls } = recordingDb([{ id: 4, status: 'completed' }]);
    expect(await updatePrivacyRequest(db, 4, { status: 'completed', resolution: '  done  ' })).toEqual({ id: 4, status: 'completed' });
    const set = calls.set?.[0] as Record<string, unknown>;
    expect(set.status).toBe('completed');
    expect(set.closedAt).toBeInstanceOf(Date);
    expect(set.resolution).toBe('done');
  });

  it('a non-terminal status does not close the request; an unknown status is ignored', async () => {
    const { db, calls } = recordingDb([{ id: 4 }]);
    await updatePrivacyRequest(db, 4, { status: 'processing' });
    expect((calls.set?.[0] as Record<string, unknown>).closedAt).toBeUndefined();
    await updatePrivacyRequest(db, 4, { status: 'whatever', resolution: null });
    const set = calls.set?.[0] as Record<string, unknown>;
    expect(set.status).toBeUndefined();
    expect(set.closedAt).toBeUndefined();
    expect(set.resolution).toBeNull();
  });

  it('answers null for an unknown id', async () => {
    expect(await updatePrivacyRequest(recordingDb([]).db, 999, { status: 'closed' })).toBeNull();
  });
});
