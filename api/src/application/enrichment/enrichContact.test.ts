import { describe, expect, it } from 'vitest';
import { EnrichmentError, enrichContact, enrichmentSavings } from './enrichContact';
import { ENRICHMENT_PROVIDER_IDS, enrichmentSpec, providerSpec } from '../integrations/dataProviderCatalog';
import { encryptCredentials } from '../integrations/credentialCrypto';
import { fakeDb, fakeFetch, type FakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

/**
 * The claim this file exists to prove: an enrichment lookup CANNOT reach a paid
 * vendor without going through `enrichment_cache` first.
 *
 * `cacheLookup` / `cacheStore` shipped with no caller, so `cacheSavings` read
 * zero and nothing anywhere asserted that the cache was on the paid path at all.
 * The tests below assert the ORDER — cache read, then credential, then vendor —
 * by counting `fetch` calls, because that is the only observation that
 * distinguishes "cached" from "cached, but we called the vendor anyway".
 */

const SECRET = 'test-secret-for-enrichment-credentials';
const TENANT = 7;

/** One enabled `integration_credentials` row for a vendor, sealed for real. */
async function credentialRow(provider: string) {
  const sealed = await encryptCredentials({ apiKey: 'k-live-123' }, SECRET, TENANT);
  return {
    id: 'cred-1',
    provider,
    name: `${provider} production`,
    credentialsEnc: sealed.enc,
    iv: sealed.iv,
  };
}

/**
 * A double whose queue is padded with generic `returning()` rows.
 *
 * The statements the test CARES about are the ones it queues explicitly at the
 * head — the credential read and the cache read. Everything after is
 * `writeProfile` fanning the normalized person out across three tables, whose
 * statement count is a property of the vendor payload rather than of the rule
 * under test. Padding keeps the assertions about the cache instead of about
 * arithmetic, while `db.calls` still records exactly what was issued.
 */
const seeded = (head: Array<unknown[]>): FakeDb =>
  fakeDb([...head, ...Array.from({ length: 16 }, () => [{ id: 1 }])]);

const deps = (db: FakeDb, fetchImpl?: typeof fetch) => ({
  db: db as unknown as Db,
  tenantId: TENANT,
  encryptionSecret: SECRET,
  ...(fetchImpl ? { fetchImpl } : {}),
});

/** The People Data Labs payload shape, trimmed to what the normalizer reads. */
const PDL_BODY = {
  data: {
    full_name: 'Dana Reyes',
    job_title: 'Staff Engineer',
    job_company_name: 'Northwind',
    location_name: 'Lisbon, Portugal',
    linkedin_url: 'https://linkedin.com/in/danareyes',
    inferred_salary_max: 184000,
    experience: [
      { company: { name: 'Northwind' }, title: { name: 'Staff Engineer' }, start_date: '2021-04', end_date: null, is_primary: true },
      { company: { name: 'Contoso' }, title: { name: 'Senior Engineer' }, start_date: '2018', end_date: '2021-03' },
    ],
    education: [
      { school: { name: 'University of Porto' }, degrees: ['BSc'], majors: ['Computer Science'], start_date: '2012', end_date: '2016' },
    ],
  },
};

describe('the enrichment catalog', () => {
  it('declares a price for every vendor, because that price IS the saving', () => {
    expect(ENRICHMENT_PROVIDER_IDS.length).toBeGreaterThanOrEqual(3);
    for (const id of ENRICHMENT_PROVIDER_IDS) {
      const spec = enrichmentSpec(id);
      expect(spec, id).not.toBeNull();
      // A zero price would make every cache hit report "saved nothing", which is
      // exactly the empty read this whole port exists to fill.
      expect(spec!.callCostCents, id).toBeGreaterThan(0);
    }
  });

  it('exposes each vendor through the same connect/test contract as every other integration', () => {
    for (const id of ENRICHMENT_PROVIDER_IDS) {
      const spec = providerSpec(id)!;
      expect(spec.family).toBe('enrichment');
      expect(spec.transport).toBe('http');
      expect(spec.credentialFields.map((f) => f.key)).toContain('apiKey');
      expect(spec.operations.some((op) => op.id === spec.testOperation)).toBe(true);
    }
  });
});

describe('enrichContact', () => {
  it('serves a cache HIT without calling the vendor at all', async () => {
    const db = seeded([
      [await credentialRow('people_data_labs')],            // resolveVendor
      [{ id: 'cache-1', payload: PDL_BODY, hitCount: 3 }],  // cacheLookup — HIT
    ]);
    const fetchImpl = fakeFetch([{ match: 'peopledatalabs.com', json: PDL_BODY }]);

    const result = await enrichContact(deps(db, fetchImpl), {
      contactRef: 'contact-9',
      email: 'Dana@Northwind.com',
    });

    // THE assertion. A hit that still called the vendor would report `cached`
    // and bill anyway — indistinguishable from a working cache on every other
    // observation.
    expect(fetchImpl.calls).toHaveLength(0);
    expect(result.cached).toBe(true);
    expect(result.centsAvoided).toBe(enrichmentSpec('people_data_labs')!.callCostCents);
    expect(result.person.fullName).toBe('Dana Reyes');
  });

  it('calls the vendor on a MISS and stores the answer with its price attached', async () => {
    const db = seeded([
      [await credentialRow('people_data_labs')],
      [],                  // cacheLookup — MISS
      [],                  // cacheStore: no existing entry
    ]);
    const fetchImpl = fakeFetch([{ match: 'peopledatalabs.com', json: PDL_BODY }]);

    const result = await enrichContact(deps(db, fetchImpl), {
      contactRef: 'contact-9',
      email: 'dana@northwind.com',
    });

    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]!.headers['x-api-key']).toBe('k-live-123');
    expect(result.cached).toBe(false);
    // Nothing was saved on the call that PAID for the entry — the saving is what
    // the next hit reports.
    expect(result.centsAvoided).toBe(0);

    const stored = db.calls.find((call) => call.kind === 'insert' && call.chain.includes('values'))!;
    const payload = stored.payload as Record<string, unknown>;
    expect(payload.provider).toBe('people_data_labs');
    expect(payload.costCentsAvoided).toBe(enrichmentSpec('people_data_labs')!.callCostCents);
    // A 64-char hex digest — the column is varchar(64), so a longer key truncates
    // and two different lookups collide onto one cached answer.
    expect(String(payload.requestHash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keys the cache on the NORMALIZED email, so one person is bought once', async () => {
    const hashFor = async (email: string): Promise<string> => {
      const db = seeded([[await credentialRow('apollo')], [], []]);
      await enrichContact(deps(db, fakeFetch([{ match: 'apollo.io', json: { person: { name: 'A', title: 'T' } } }])), {
        contactRef: 'contact-9',
        email,
      });
      const insert = db.calls.find((call) => call.kind === 'insert' && call.chain.includes('values'))!;
      return String((insert.payload as Record<string, unknown>).requestHash);
    };
    expect(await hashFor('Dana@Northwind.com ')).toBe(await hashFor('dana@northwind.com'));
  });

  it('does NOT cache an empty answer', async () => {
    const db = fakeDb([
      [await credentialRow('people_data_labs')],
      [],  // cacheLookup — MISS
    ]);
    const fetchImpl = fakeFetch([{ match: 'peopledatalabs.com', json: { data: {} } }]);

    const result = await enrichContact(deps(db, fetchImpl), { contactRef: 'contact-9', email: 'nobody@example.com' });

    expect(result.person.fullName).toBeNull();
    // Caching a hollow answer would keep a contact unknown for the whole TTL
    // even after the vendor indexed them.
    expect(db.calls.some((call) => call.kind === 'insert')).toBe(false);
  });

  it('writes compensation as INFERRED, never verified', async () => {
    const db = seeded([[await credentialRow('people_data_labs')], [], []]);
    await enrichContact(deps(db, fakeFetch([{ match: 'peopledatalabs.com', json: PDL_BODY }])), {
      contactRef: 'contact-9',
      email: 'dana@northwind.com',
    });

    const comp = db.calls
      .filter((call) => call.kind === 'insert')
      .map((call) => call.payload as Record<string, unknown> | undefined)
      .find((payload) => payload?.confidence !== undefined);
    expect(comp!.confidence).toBe('inferred');
    expect(comp!.base).toBe('184000');
  });

  it('normalizes all three vendors onto ONE person shape', async () => {
    const cases = [
      {
        provider: 'clearbit',
        match: 'clearbit.com',
        body: { name: { fullName: 'Kai Osei' }, employment: { name: 'Initech', title: 'CTO' }, geo: { city: 'Accra' } },
        expect: { fullName: 'Kai Osei', company: 'Initech', title: 'CTO', roles: 1 },
      },
      {
        provider: 'apollo',
        match: 'apollo.io',
        body: {
          person: {
            name: 'Rin Sato', title: 'VP Product', city: 'Osaka',
            organization: { name: 'Globex' },
            employment_history: [{ organization_name: 'Globex', title: 'VP Product', current: true, start_date: '2020-01-01' }],
          },
        },
        expect: { fullName: 'Rin Sato', company: 'Globex', title: 'VP Product', roles: 1 },
      },
      {
        provider: 'people_data_labs',
        match: 'peopledatalabs.com',
        body: PDL_BODY,
        expect: { fullName: 'Dana Reyes', company: 'Northwind', title: 'Staff Engineer', roles: 2 },
      },
    ];

    for (const scenario of cases) {
      const db = seeded([[await credentialRow(scenario.provider)], [], []]);
      const result = await enrichContact(deps(db, fakeFetch([{ match: scenario.match, json: scenario.body }])), {
        contactRef: 'contact-9',
        email: 'someone@example.com',
        provider: scenario.provider,
      });
      expect(result.person.fullName, scenario.provider).toBe(scenario.expect.fullName);
      expect(result.person.company, scenario.provider).toBe(scenario.expect.company);
      expect(result.person.title, scenario.provider).toBe(scenario.expect.title);
      expect(result.person.roles.length, scenario.provider).toBe(scenario.expect.roles);
    }
  });

  it('says WHICH vendor to connect when none is', async () => {
    const db = fakeDb([[]]);
    await expect(enrichContact(deps(db), { contactRef: 'c', email: 'a@b.com' }))
      .rejects.toThrow(/Connect Clearbit, People Data Labs or Apollo/);
  });

  it('keeps a vendor 402 as a 402, because that is the one refusal an operator can act on', async () => {
    const db = seeded([[await credentialRow('clearbit')], []]);
    const fetchImpl = fakeFetch([{ match: 'clearbit.com', status: 402, json: { error: 'out of credits' } }]);
    await expect(enrichContact(deps(db, fetchImpl), { contactRef: 'c', email: 'a@b.com' }))
      .rejects.toMatchObject({ status: 402 });
  });

  it('refuses an address that is not one, before spending anything', async () => {
    const db = fakeDb([]);
    await expect(enrichContact(deps(db), { contactRef: 'c', email: 'not-an-email' }))
      .rejects.toBeInstanceOf(EnrichmentError);
    expect(db.calls).toHaveLength(0);
  });
});

describe('enrichmentSavings', () => {
  it('reports only enrichment providers, named for a human', async () => {
    const db = fakeDb([[
      { provider: 'people_data_labs', entries: 4, hits: 9, centsAvoided: 90, live: 4 },
      { provider: 'postgres', entries: 1, hits: 1, centsAvoided: 0, live: 1 },
    ]]);
    const rows = await enrichmentSavings(db as unknown as Db, TENANT);
    expect(rows).toEqual([
      { provider: 'people_data_labs', entries: 4, hits: 9, centsAvoided: 90, live: 4, providerLabel: 'People Data Labs' },
    ]);
  });
});
