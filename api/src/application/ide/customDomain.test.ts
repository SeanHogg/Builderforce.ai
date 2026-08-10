import { describe, expect, it } from 'vitest';
import {
  claimCustomDomain,
  cloudflareHostnameClient,
  cnamePointsAtUs,
  domainInstructions,
  isUniqueViolation,
  releaseCustomDomain,
  statusFromCertificate,
  verifyCustomDomain,
  type CustomHostnameClient,
} from './customDomain';
import { fakeDb, fakeFetch, whereColumns } from '../../../test/fakeDb';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const env = { JWT_SECRET: 'test' } as unknown as Env;

/** A stored site row shaped like the SITE_DOMAIN_COLUMNS projection. */
function siteRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    customDomain: null,
    customDomainStatus: 'unset',
    customDomainToken: null,
    customDomainVerifiedAt: null,
    customDomainError: null,
    customDomainHostnameId: null,
    ...over,
  };
}

function txtAnswer(...values: string[]) {
  return {
    match: 'dns-query',
    json: { Status: 0, Answer: values.map((v) => ({ type: 16, data: `"${v}"` })) },
  };
}

describe('domainInstructions', () => {
  it('gives both records the tenant must publish', () => {
    const steps = domainInstructions('shop.example.com', 'tok123');
    expect(steps.txt).toEqual({ name: '_builderforce-challenge.shop.example.com', value: 'tok123' });
    expect(steps.cname).toEqual({ name: 'shop.example.com', value: 'builderforce.ai' });
  });
});

describe('statusFromCertificate', () => {
  it('only `active` is live', () => {
    expect(statusFromCertificate('active')).toBe('active');
  });

  it('terminal Cloudflare states are failures, not perpetual pending', () => {
    expect(statusFromCertificate('blocked')).toBe('failed');
    expect(statusFromCertificate('moved')).toBe('failed');
    expect(statusFromCertificate('deleted')).toBe('failed');
  });

  it('anything still in flight — including an unknown state — stays pending', () => {
    expect(statusFromCertificate('pending_validation')).toBe('pending_certificate');
    expect(statusFromCertificate('initializing')).toBe('pending_certificate');
    expect(statusFromCertificate(undefined)).toBe('pending_certificate');
    expect(statusFromCertificate('some-new-cloudflare-state')).toBe('pending_certificate');
  });
});

describe('cloudflareHostnameClient', () => {
  it('is null when the account is not configured — the caller must degrade, not throw', () => {
    expect(cloudflareHostnameClient({} as Env)).toBeNull();
    expect(cloudflareHostnameClient({ CLOUDFLARE_ZONE_ID: 'z' } as Env)).toBeNull();
    expect(cloudflareHostnameClient({ CLOUDFLARE_SAAS_API_TOKEN: 't' } as Env)).toBeNull();
  });

  it('creates a custom hostname on the configured zone with a bearer token', async () => {
    const fetchImpl = fakeFetch([{
      match: 'custom_hostnames',
      json: { success: true, result: { id: 'ch_1', ssl: { status: 'pending_validation' } } },
    }]);
    const client = cloudflareHostnameClient(
      { CLOUDFLARE_ZONE_ID: 'zone1', CLOUDFLARE_SAAS_API_TOKEN: 'tok' } as Env,
      fetchImpl,
    )!;
    const result = await client.create('shop.example.com');
    expect(result).toMatchObject({ ok: true, hostnameId: 'ch_1', certificateStatus: 'pending_validation' });
    expect(fetchImpl.calls[0]!.url).toContain('/zones/zone1/custom_hostnames');
    expect(fetchImpl.calls[0]!.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(fetchImpl.calls[0]!.body!).hostname).toBe('shop.example.com');
  });

  it('surfaces Cloudflare\'s own error message rather than a generic one', async () => {
    const fetchImpl = fakeFetch([{
      match: 'custom_hostnames',
      status: 400,
      json: { success: false, errors: [{ message: 'hostname already exists' }] },
    }]);
    const client = cloudflareHostnameClient(
      { CLOUDFLARE_ZONE_ID: 'z', CLOUDFLARE_SAAS_API_TOKEN: 't' } as Env,
      fetchImpl,
    )!;
    await expect(client.create('x.example.com')).resolves.toMatchObject({
      ok: false, error: 'hostname already exists',
    });
  });
});

describe('claimCustomDomain', () => {
  it('rejects a hostname that is not one we can host', async () => {
    const db = fakeDb();
    const result = await claimCustomDomain(env, db as unknown as Db, 1, 10, 'not a domain');
    expect(result).toMatchObject({ ok: false, status: 400 });
    // Rejected before any query — validation is not a database concern.
    expect(db.calls).toHaveLength(0);
  });

  it('404s when the project has no published site yet', async () => {
    const db = fakeDb([[]]);
    const result = await claimCustomDomain(env, db as unknown as Db, 1, 10, 'example.com');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('409s when ANOTHER PROJECT IN THIS WORKSPACE already uses the hostname', async () => {
    const db = fakeDb([
      [{ id: 5, customDomain: null }],   // this project's site
      [{ projectId: 99 }],               // a sibling project already has it
    ]);
    const result = await claimCustomDomain(env, db as unknown as Db, 1, 10, 'example.com');
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect((result as { error: string }).error).toContain('this workspace');
    // No write was attempted.
    expect(db.calls.some((c) => c.kind === 'update')).toBe(false);
  });

  it('never reads across tenants — the collision check is tenant-scoped', async () => {
    // A cross-tenant pre-check would let anyone probe which domains other
    // customers own. The unique index is the arbiter for that case instead.
    const db = fakeDb([
      [{ id: 5, customDomain: null }],
      [],
      [siteRow({ customDomain: 'example.com', customDomainStatus: 'pending_dns', customDomainToken: 'tok' })],
    ]);
    await claimCustomDomain(env, db as unknown as Db, 1, 10, 'example.com');
    const columns = whereColumns(db.calls[1]!.where);
    expect(columns).toContain('tenant_id');
    expect(columns).toContain('custom_domain');
  });

  it('translates the platform-wide unique-index violation into a 409', async () => {
    const conflict = new Error(
      'duplicate key value violates unique constraint "uq_project_sites_custom_domain"',
    );
    const db = fakeDb([
      [{ id: 5, customDomain: null }],
      [],          // nothing in THIS workspace uses it…
      conflict,    // …but another tenant does, and only the DB can see that
    ]);
    const result = await claimCustomDomain(env, db as unknown as Db, 1, 10, 'example.com');
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect((result as { error: string }).error).toContain('another site');
  });

  it('does NOT swallow an unrelated database error as a domain conflict', async () => {
    const db = fakeDb([
      [{ id: 5, customDomain: null }],
      [],
      new Error('connection terminated unexpectedly'),
    ]);
    await expect(claimCustomDomain(env, db as unknown as Db, 1, 10, 'example.com'))
      .rejects.toThrow('connection terminated');
  });

  it('claims, issues a token, and parks at pending_dns — never active', async () => {
    const db = fakeDb([
      [{ id: 5, customDomain: null }],
      [],
      [siteRow({ customDomain: 'example.com', customDomainStatus: 'pending_dns', customDomainToken: 'tok' })],
    ]);
    const result = await claimCustomDomain(env, db as unknown as Db, 1, 10, 'HTTPS://Example.com/path');
    expect(result.ok).toBe(true);
    const state = (result as { state: { hostname: string; status: string; live: boolean; instructions: unknown } }).state;
    expect(state.hostname).toBe('example.com');
    expect(state.status).toBe('pending_dns');
    expect(state.live).toBe(false);
    expect(state.instructions).not.toBeNull();

    // A fresh, non-null token must be written on every claim.
    const update = db.calls.find((c) => c.kind === 'update')!;
    expect((update.payload as { customDomainToken: string }).customDomainToken).toMatch(/^[a-f0-9]{32}$/);
    expect((update.payload as { customDomainStatus: string }).customDomainStatus).toBe('pending_dns');
  });
});

describe('verifyCustomDomain', () => {
  it('stays at pending_dns with a specific reason when the TXT record is absent', async () => {
    const db = fakeDb([
      [siteRow({ customDomain: 'example.com', customDomainStatus: 'pending_dns', customDomainToken: 'tok' })],
      [siteRow({ customDomain: 'example.com', customDomainStatus: 'pending_dns', customDomainToken: 'tok' })],
    ]);
    const fetchImpl = fakeFetch([{ match: 'dns-query', json: { Status: 0, Answer: [] } }]);
    const result = await verifyCustomDomain(env, db as unknown as Db, 1, 10, { fetchImpl, hostnameClient: null });
    expect(result.ok).toBe(true);
    const written = db.calls.find((c) => c.kind === 'update')!.payload as { customDomainStatus: string; customDomainError: string };
    expect(written.customDomainStatus).toBe('pending_dns');
    expect(written.customDomainError).toContain('_builderforce-challenge.example.com');
  });

  it('proves ownership WITHOUT a Cloudflare account, and says why it is not live', async () => {
    // This is the honest-degradation path: the entitlement is missing, so the
    // domain cannot serve — but ownership is still established and the reason
    // is stated instead of claiming success.
    const db = fakeDb([
      [siteRow({ customDomain: 'example.com', customDomainStatus: 'pending_dns', customDomainToken: 'tok' })],
      [siteRow({ customDomain: 'example.com', customDomainStatus: 'pending_certificate', customDomainToken: 'tok' })],
    ]);
    const fetchImpl = fakeFetch([txtAnswer('tok')]);
    const result = await verifyCustomDomain(env, db as unknown as Db, 1, 10, { fetchImpl, hostnameClient: null });

    const written = db.calls.find((c) => c.kind === 'update')!.payload as { customDomainStatus: string; customDomainError: string };
    expect(written.customDomainStatus).toBe('pending_certificate');
    expect(written.customDomainError).toContain('CLOUDFLARE_SAAS_API_TOKEN');
    expect((result as { state: { live: boolean } }).state.live).toBe(false);
  });

  it('requests a certificate once ownership holds, and goes live when it issues', async () => {
    const db = fakeDb([
      [siteRow({ customDomain: 'example.com', customDomainStatus: 'pending_dns', customDomainToken: 'tok' })],
      [siteRow({ customDomain: 'example.com', customDomainStatus: 'active', customDomainToken: 'tok' })],
    ]);
    const created: string[] = [];
    const hostnameClient: CustomHostnameClient = {
      create: async (hostname) => { created.push(hostname); return { ok: true, hostnameId: 'ch_9', certificateStatus: 'active' }; },
      status: async () => ({ ok: true, certificateStatus: 'active' }),
      remove: async () => undefined,
    };
    const fetchImpl = fakeFetch([txtAnswer('tok')]);
    const result = await verifyCustomDomain(env, db as unknown as Db, 1, 10, { fetchImpl, hostnameClient });

    expect(created).toEqual(['example.com']);
    const written = db.calls.find((c) => c.kind === 'update')!.payload as { customDomainStatus: string; customDomainHostnameId: string };
    expect(written.customDomainStatus).toBe('active');
    expect(written.customDomainHostnameId).toBe('ch_9');
    expect((result as { state: { live: boolean } }).state.live).toBe(true);
  });

  it('REFRESHES an existing hostname instead of creating a duplicate', async () => {
    const db = fakeDb([
      [siteRow({
        customDomain: 'example.com', customDomainStatus: 'pending_certificate',
        customDomainToken: 'tok', customDomainHostnameId: 'ch_existing',
      })],
      [siteRow({ customDomain: 'example.com', customDomainStatus: 'active', customDomainToken: 'tok' })],
    ]);
    let createCalls = 0;
    let statusCalls = 0;
    const hostnameClient: CustomHostnameClient = {
      create: async () => { createCalls += 1; return { ok: true }; },
      status: async () => { statusCalls += 1; return { ok: true, hostnameId: 'ch_existing', certificateStatus: 'active' }; },
      remove: async () => undefined,
    };
    await verifyCustomDomain(env, db as unknown as Db, 1, 10, {
      fetchImpl: fakeFetch([txtAnswer('tok')]), hostnameClient,
    });
    expect(createCalls).toBe(0);
    expect(statusCalls).toBe(1);
  });

  it('rejects verifying a project that has no domain claimed', async () => {
    const db = fakeDb([[siteRow()]]);
    const result = await verifyCustomDomain(env, db as unknown as Db, 1, 10, { hostnameClient: null });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});

describe('releaseCustomDomain', () => {
  it('clears routing and best-effort deletes the Cloudflare hostname', async () => {
    const db = fakeDb([
      [siteRow({ customDomain: 'example.com', customDomainStatus: 'active', customDomainHostnameId: 'ch_1' })],
      [siteRow()],
    ]);
    const removed: string[] = [];
    const hostnameClient: CustomHostnameClient = {
      create: async () => ({ ok: true }),
      status: async () => ({ ok: true }),
      remove: async (id) => { removed.push(id); },
    };
    const result = await releaseCustomDomain(env, db as unknown as Db, 1, 10, { hostnameClient });
    expect(removed).toEqual(['ch_1']);
    const written = db.calls.find((c) => c.kind === 'update')!.payload as Record<string, unknown>;
    expect(written.customDomain).toBeNull();
    expect(written.customDomainStatus).toBe('unset');
    expect((result as { state: { live: boolean } }).state.live).toBe(false);
  });
});

describe('cnamePointsAtUs', () => {
  it('is true only when the CNAME actually targets our apex', async () => {
    const ours = fakeFetch([{ match: 'dns-query', json: { Status: 0, Answer: [{ type: 5, data: 'builderforce.ai.' }] } }]);
    await expect(cnamePointsAtUs('shop.example.com', { fetchImpl: ours })).resolves.toBe(true);

    const elsewhere = fakeFetch([{ match: 'dns-query', json: { Status: 0, Answer: [{ type: 5, data: 'other.host.com.' }] } }]);
    await expect(cnamePointsAtUs('shop.example.com', { fetchImpl: elsewhere })).resolves.toBe(false);
  });
});

describe('isUniqueViolation', () => {
  it('recognises the custom-domain conflict from the driver message or code', () => {
    expect(isUniqueViolation(new Error(
      'duplicate key value violates unique constraint "uq_project_sites_custom_domain"',
    ))).toBe(true);
    const coded = Object.assign(new Error('uq_project_sites_custom_domain'), { code: '23505' });
    expect(isUniqueViolation(coded)).toBe(true);
  });

  it('is NARROW — a different unique violation is not a taken domain', () => {
    // Reporting "that domain is taken" for an unrelated conflict would send the
    // user chasing a problem they do not have.
    expect(isUniqueViolation(new Error(
      'duplicate key value violates unique constraint "uq_marketing_sender_tenant_email"',
    ))).toBe(false);
    expect(isUniqueViolation(new Error('connection reset'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
