import { describe, expect, it, vi } from 'vitest';
import { fetchBurnRate } from './burnRateService';

/** Mock db whose two select() calls return the tenant row then the segment row. */
function makeDb(tenantSettings: string | null, segmentRow: { externalAccountId: string | null; externalCompanyId: string | null } | null) {
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

const hostBi = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ hostBi: { baseUrl: 'https://host.example', token: 'tok' }, ...extra });

describe('fetchBurnRate', () => {
  it('returns not_configured when host BI config is absent', async () => {
    const db = makeDb(null, { externalAccountId: 'a', externalCompanyId: 'c' });
    const res = await fetchBurnRate(db, { tenantId: 1, segmentId: 'seg', fetchImpl: vi.fn() });
    expect(res).toEqual({ available: false, reason: 'not_configured' });
  });

  it('returns no_company when the segment has no external company id', async () => {
    const db = makeDb(hostBi(), { externalAccountId: 'a', externalCompanyId: null });
    const res = await fetchBurnRate(db, { tenantId: 1, segmentId: 'seg', fetchImpl: vi.fn() });
    expect(res).toEqual({ available: false, reason: 'no_company' });
  });

  it('pulls burn + runway and passes the bearer token + company id', async () => {
    const db = makeDb(hostBi(), { externalAccountId: 'acct', externalCompanyId: 'co' });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ monthlyBurn: 50000, runwayMonths: 8 }), { status: 200 }));
    const res = await fetchBurnRate(db, { tenantId: 1, segmentId: 'seg', fetchImpl });
    expect(res).toEqual({ available: true, source: 'host', monthlyBurn: 50000, runwayMonths: 8 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('https://host.example/api/bi/burn-rate?');
    expect(url).toContain('companyId=co');
    expect(url).toContain('accountId=acct');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('degrades to unavailable on a non-200', async () => {
    const db = makeDb(hostBi(), { externalAccountId: null, externalCompanyId: 'co' });
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 502 }));
    const res = await fetchBurnRate(db, { tenantId: 1, segmentId: 'seg', fetchImpl });
    expect(res).toEqual({ available: false, reason: 'unreachable' });
  });

  it('degrades to bad_response when neither metric is present', async () => {
    const db = makeDb(hostBi(), { externalAccountId: null, externalCompanyId: 'co' });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ unrelated: 1 }), { status: 200 }));
    const res = await fetchBurnRate(db, { tenantId: 1, segmentId: 'seg', fetchImpl });
    expect(res).toEqual({ available: false, reason: 'bad_response' });
  });

  it('never throws when fetch rejects', async () => {
    const db = makeDb(hostBi(), { externalAccountId: null, externalCompanyId: 'co' });
    const fetchImpl = vi.fn(async () => { throw new Error('boom'); });
    const res = await fetchBurnRate(db, { tenantId: 1, segmentId: 'seg', fetchImpl });
    expect(res).toEqual({ available: false, reason: 'unreachable' });
  });
});
