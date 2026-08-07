/**
 * The `search` half of the cloud `web` capability. Three things matter here and they
 * are all load-bearing:
 *
 *   1. ALWAYS BACKED — search no longer self-gates on a BYO key. `resolveWebSearchBacking`
 *      always resolves a vendor (tenant key → operator key → keyless floor), so
 *      `web.search` is a surface capability and `web_search` is always advertised. The
 *      old rule ("never advertise a tool certain to fail") is satisfied because the
 *      tool can no longer be certain to fail.
 *   2. CACHING — a repeated (or merely re-worded) query must not be a second billable
 *      vendor call, and must go through the canonical read-through cache.
 *   3. METERING — a real query is one outbound fetch on the tenant's meter; a CACHED
 *      query is neither charged nor gated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSearchResult } from '@builderforce/agent-tools';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const enforceOutboundFetchCap = vi.hoisted(() => vi.fn(async () => ({ allowed: true as const })));
const recordOutboundFetch = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../web/outboundFetchLedger', () => ({ enforceOutboundFetchCap, recordOutboundFetch }));

import { buildCloudWebCapability, normalizeSearchQuery, searchWeb } from './cloudWeb';
import { CLOUD_AGENT_TOOLS, CLOUD_SURFACE_CAPS } from './cloudAgentTools';
import type { WebSearchVendor } from './webSearchVendors';

/** No KV bound → `getOrSetCached` uses its L1 map only, which is exactly the isolate
 *  behaviour a DO tick sees. `test/setup.ts` clears L1 between tests. */
const env = { JWT_SECRET: 'test' } as unknown as Env;
const db = {} as Db;

/** A fake vendor that counts real calls — the thing the cache must suppress. */
function fakeVendor(result: WebSearchResult = { ok: true, query: 'q', results: [{ url: 'https://example.com' }] }) {
  const search = vi.fn(async (query: string): Promise<WebSearchResult> => ({ ...result, query }));
  const vendor: WebSearchVendor = {
    id: 'tavily', label: 'Fake', endpoint: 'https://vendor.example/search',
    coverage: 'web', attribution: 'Fake', keyless: false, credentialField: 'apiKey', search,
  };
  return { vendor, search };
}

beforeEach(() => {
  enforceOutboundFetchCap.mockClear();
  enforceOutboundFetchCap.mockResolvedValue({ allowed: true as const });
  recordOutboundFetch.mockClear();
});

describe('always backed', () => {
  it('wires both halves of the capability', () => {
    const { vendor } = fakeVendor();
    const web = buildCloudWebCapability({ env, search: { vendor, apiKey: 'k' } });
    expect(web.search).toBeInstanceOf(Function);
    expect(typeof web.fetch).toBe('function');
  });

  it('runs a KEYLESS backing without an apiKey', async () => {
    const search = vi.fn(async (query: string): Promise<WebSearchResult> => {
      expect(apiKey).toBeNull();
      return { ok: true, query, results: [], coverage: 'encyclopedic' };
    });
    const vendor: WebSearchVendor = {
      id: 'wikipedia', label: 'Fake keyless', endpoint: 'https://keyless.example/api',
      coverage: 'encyclopedic', attribution: 'Fake', keyless: true, search,
    };
    const r = await searchWeb(env, { vendor, apiKey: null }, 'keyless research');
    expect(r).toMatchObject({ ok: true, coverage: 'encyclopedic' });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('advertises `web_search` on the durable surface', () => {
    expect(CLOUD_SURFACE_CAPS.has('web.search')).toBe(true);
    expect(CLOUD_SURFACE_CAPS.has('web')).toBe(true); // fetch is not lost
    const names = CLOUD_AGENT_TOOLS.map((t) => t.function.name);
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
  });
});

describe('search execution + cache', () => {
  it('returns the vendor results', async () => {
    const { vendor } = fakeVendor();
    const web = buildCloudWebCapability({ env, search: { vendor, apiKey: 'k' } });
    const r = await web.search!('typescript satisfies operator');
    expect(r.ok).toBe(true);
    expect(r.results).toEqual([{ url: 'https://example.com' }]);
  });

  it('serves a repeated query from the read-through cache — one real vendor call', async () => {
    const { vendor, search } = fakeVendor();
    const web = buildCloudWebCapability({ env, search: { vendor, apiKey: 'k' } });
    await web.search!('cloudflare durable objects');
    await web.search!('cloudflare durable objects');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('caches on the NORMALIZED query, so casing/whitespace variants are one paid call', async () => {
    const { vendor, search } = fakeVendor();
    const web = buildCloudWebCapability({ env, search: { vendor, apiKey: 'k' } });
    await web.search!('Durable  Objects');
    await web.search!('  durable objects ');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('keys distinct queries separately', async () => {
    const { vendor, search } = fakeVendor();
    const web = buildCloudWebCapability({ env, search: { vendor, apiKey: 'k' } });
    await web.search!('alpha');
    await web.search!('beta');
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('never pins a FAILED search for the TTL — the next step retries for real', async () => {
    const { vendor, search } = fakeVendor({ ok: false, error: 'vendor 503' });
    const web = buildCloudWebCapability({ env, search: { vendor, apiKey: 'k' } });
    await web.search!('flaky');
    await web.search!('flaky');
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty query without touching the vendor', async () => {
    const { vendor, search } = fakeVendor();
    const web = buildCloudWebCapability({ env, search: { vendor, apiKey: 'k' } });
    const r = await web.search!('   ');
    expect(r).toMatchObject({ ok: false });
    expect(search).not.toHaveBeenCalled();
  });
});

describe('consumption metering', () => {
  it('records one outbound fetch per REAL query', async () => {
    const { vendor } = fakeVendor();
    const web = buildCloudWebCapability({ env, search: { vendor, auth: { apiKey: 'k' }, meter: { db, tenantId: 7 } } });
    await web.search!('metered query');
    expect(recordOutboundFetch).toHaveBeenCalledTimes(1);
    expect(recordOutboundFetch).toHaveBeenCalledWith(db, 7, vendor.endpoint);
  });

  it('does NOT meter or gate a cache hit', async () => {
    const { vendor } = fakeVendor();
    const web = buildCloudWebCapability({ env, search: { vendor, auth: { apiKey: 'k' }, meter: { db, tenantId: 7 } } });
    await web.search!('cached query');
    await web.search!('cached query');
    expect(recordOutboundFetch).toHaveBeenCalledTimes(1);
    expect(enforceOutboundFetchCap).toHaveBeenCalledTimes(1);
  });

  it('refuses a query once the tenant is over its monthly allowance', async () => {
    enforceOutboundFetchCap.mockResolvedValue({ allowed: false, effectivePlan: 'free', used: 500, limit: 500 } as never);
    const { vendor, search } = fakeVendor();
    const web = buildCloudWebCapability({ env, search: { vendor, auth: { apiKey: 'k' }, meter: { db, tenantId: 7 } } });
    const r = await web.search!('over cap');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/allowance exhausted/);
    expect(search).not.toHaveBeenCalled();
    expect(recordOutboundFetch).not.toHaveBeenCalled();
  });

  it('skips metering when no tenant is in scope', async () => {
    const { vendor } = fakeVendor();
    const web = buildCloudWebCapability({ env, search: { vendor, apiKey: 'k' } });
    await web.search!('unmetered');
    expect(enforceOutboundFetchCap).not.toHaveBeenCalled();
    expect(recordOutboundFetch).not.toHaveBeenCalled();
  });
});

describe('normalizeSearchQuery', () => {
  it('collapses case and whitespace (one cache identity per real question)', () => {
    expect(normalizeSearchQuery('  React   Server \n Components ')).toBe('react server components');
    expect(normalizeSearchQuery('')).toBe('');
  });
});
