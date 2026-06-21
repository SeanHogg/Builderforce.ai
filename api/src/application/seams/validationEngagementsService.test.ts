import { describe, expect, it, vi } from 'vitest';
import { fetchValidationEngagements } from './validationEngagementsService';

/** Mock db whose two select() calls return the tenant row then the segment row. */
function makeDb(
  tenantSettings: string | null,
  segmentRow: { externalAccountId: string | null; externalCompanyId: string | null } | null,
) {
  let call = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            call += 1;
            if (call === 1) return [{ settings: tenantSettings }];
            return segmentRow ? [segmentRow] : [];
          },
        }),
      }),
    }),
  };
  return db as any;
}

const hostBi = () => JSON.stringify({ hostBi: { baseUrl: 'https://host.example', token: 'tok' } });

describe('fetchValidationEngagements', () => {
  it('returns not_configured when host BI config is absent', async () => {
    const db = makeDb(null, { externalAccountId: 'a', externalCompanyId: 'c' });
    const res = await fetchValidationEngagements(db, { tenantId: 1, segmentId: 'seg', fetchImpl: vi.fn() });
    expect(res).toEqual({ available: false, reason: 'not_configured' });
  });

  it('returns no_company when the segment has no external company id', async () => {
    const db = makeDb(hostBi(), { externalAccountId: 'a', externalCompanyId: null });
    const res = await fetchValidationEngagements(db, { tenantId: 1, segmentId: 'seg', fetchImpl: vi.fn() });
    expect(res).toEqual({ available: false, reason: 'no_company' });
  });

  it('lists engagements and passes the bearer token + company id', async () => {
    const db = makeDb(hostBi(), { externalAccountId: 'acct', externalCompanyId: 'co' });
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ engagements: [{ id: 'e1', title: 'NPS widget', type: 'survey', responses: 12 }, { widgetId: 'w2', status: 'active' }] }),
        { status: 200 },
      ),
    );
    const res = await fetchValidationEngagements(db, { tenantId: 1, segmentId: 'seg', fetchImpl });
    expect(res.available).toBe(true);
    expect(res.source).toBe('host');
    expect(res.engagements).toEqual([
      { id: 'e1', name: 'NPS widget', kind: 'survey', status: undefined, responses: 12 },
      { id: 'w2', name: undefined, kind: undefined, status: 'active', responses: undefined },
    ]);
    const [url, init] = (fetchImpl.mock.calls as any[])[0] as [string, RequestInit];
    expect(url).toContain('https://host.example/api/validation/engagements?');
    expect(url).toContain('companyId=co');
    expect(url).toContain('accountId=acct');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('accepts a bare array body too', async () => {
    const db = makeDb(hostBi(), { externalAccountId: null, externalCompanyId: 'co' });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ id: 'x' }]), { status: 200 }));
    const res = await fetchValidationEngagements(db, { tenantId: 1, segmentId: 'seg', fetchImpl });
    expect(res.available).toBe(true);
    expect(res.engagements).toEqual([{ id: 'x', name: undefined, kind: undefined, status: undefined, responses: undefined }]);
  });

  it('degrades to unreachable on a non-200', async () => {
    const db = makeDb(hostBi(), { externalAccountId: null, externalCompanyId: 'co' });
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 502 }));
    const res = await fetchValidationEngagements(db, { tenantId: 1, segmentId: 'seg', fetchImpl });
    expect(res).toEqual({ available: false, reason: 'unreachable' });
  });

  it('degrades to bad_response when the body is not a list', async () => {
    const db = makeDb(hostBi(), { externalAccountId: null, externalCompanyId: 'co' });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ unrelated: 1 }), { status: 200 }));
    const res = await fetchValidationEngagements(db, { tenantId: 1, segmentId: 'seg', fetchImpl });
    expect(res).toEqual({ available: false, reason: 'bad_response' });
  });

  it('never throws when fetch rejects', async () => {
    const db = makeDb(hostBi(), { externalAccountId: null, externalCompanyId: 'co' });
    const fetchImpl = vi.fn(async () => { throw new Error('boom'); });
    const res = await fetchValidationEngagements(db, { tenantId: 1, segmentId: 'seg', fetchImpl });
    expect(res).toEqual({ available: false, reason: 'unreachable' });
  });
});
