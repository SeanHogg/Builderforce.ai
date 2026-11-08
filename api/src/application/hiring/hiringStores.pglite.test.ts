/**
 * The hiring sweep store and the candidate-ref salt against REAL Postgres (PGlite): migration
 * 1334 is executed from its file, and the statements are the ones the application issues.
 *
 * Proves: a touch returns the row AS IT STANDS (never the batch snapshot) and a stale lease's
 * state write is dropped while the newer holder's stands; two getters of a tenant's candidate-ref
 * salt agree and each tenant has its own; deleting a tenant takes its salt; the tenant-board
 * worklist rotates; and the link-finding pass has a rotation key of its own.
 *
 * What PGlite CANNOT prove: true cross-connection races. It is ONE session, so "two concurrent
 * getters" are two statements interleaved on one connection, which is still the
 * insert-or-ignore-then-read sequence the code runs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

import {
  listPostedDistributionsForSweep,
  listTenantBoardKeys,
  readPostedDistribution,
  readPostedDistributions,
  recordResolvedLink,
  saveImportState,
  touchNonImportableBoard,
  touchPostedDistribution,
  touchResolveAttempt,
  type PostedDistribution,
} from './postingDistributionSweepStore';
import { clearRefSaltCache, loadRefSalt } from './refSalt';

const migration = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url).href), 'utf8');

let pg: PGlite;
let db: Db;

/** The tables reduced to the columns drizzle names when it selects or updates them. */
const TABLES = `
CREATE TABLE tenants (id serial PRIMARY KEY);
CREATE TABLE job_postings (id varchar(36) PRIMARY KEY, tenant_id integer NOT NULL, status varchar(20) NOT NULL DEFAULT 'open');
CREATE TABLE job_posting_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id integer NOT NULL, job_posting_id varchar(36) NOT NULL,
  connector_key varchar(64) NOT NULL, connection_id uuid, external_id varchar(255), url varchar(1000), status varchar(16) NOT NULL,
  posted_at timestamp, last_error text, import_cursor varchar(64), import_resume_page integer, import_pending_cursor varchar(64),
  import_failures jsonb NOT NULL DEFAULT '{}', import_checked_at timestamp, import_resume_token varchar(512),
  board_filter_id varchar(255), resolve_retry_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE hiring_ref_salts (tenant_id integer PRIMARY KEY, salt varchar(64) NOT NULL, created_at timestamp NOT NULL DEFAULT now());
`;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(TABLES);
  db = drizzle(pg) as unknown as Db;
});
afterAll(async () => { await pg.close(); });

beforeEach(async () => {
  await pg.exec('TRUNCATE hiring_ref_salts, job_posting_distributions, job_postings, tenants RESTART IDENTITY CASCADE');
  await pg.exec('INSERT INTO tenants DEFAULT VALUES; INSERT INTO tenants DEFAULT VALUES; INSERT INTO tenants DEFAULT VALUES;');
  clearRefSaltCache();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An open posting with a confirmed publication on `key`. */
async function publish(tenant: number, posting: string, key: string, over: { checked?: string | null; url?: string | null } = {}): Promise<void> {
  await pg.query(`INSERT INTO job_postings (id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [posting, tenant]);
  await pg.query(
    `INSERT INTO job_posting_distributions (tenant_id, job_posting_id, connector_key, external_id, status, import_checked_at, url)
     VALUES ($1, $2, $3, $6::text, 'posted', $4, $5)`,
    [tenant, posting, key, over.checked ?? null, over.url ?? null, `EXT-${posting}`],
  );
}

const only = async (tenant: number, posting: string): Promise<PostedDistribution> => (await readPostedDistributions(db, tenant, posting))[0]!;
const column = async (tenant: number, posting: string, name: string): Promise<unknown> =>
  (await pg.query<Record<string, unknown>>(`SELECT ${name} AS v FROM job_posting_distributions WHERE tenant_id = $1 AND job_posting_id = $2`, [tenant, posting])).rows[0]!.v;

describe('the lease: touch returns the row as it stands, and a stale lease cannot write', () => {
  it('a dropped write leaves the newer holder\'s state, and the next touch SEES it (not the batch snapshot)', async () => {
    await publish(1, 'p1', 'acme');
    const snapshot = await only(1, 'p1'); // what a sweep batch read, long before it got to this row

    const manual = (await touchPostedDistribution(db, snapshot))!; // a press of "Import" takes the row…
    expect(manual.importLease).toBeTruthy();
    expect(await saveImportState(db, manual, { cursor: '2026-10-01T00:00:00.000Z', resumePage: null, pendingCursor: null, failures: { a: 1 } })).toBe(true);

    await sleep(5);
    const sweep = (await touchPostedDistribution(db, snapshot))!; // …then the sweep reaches it with the OLD snapshot
    expect(snapshot.importCursor).toBeNull();
    expect(sweep.importCursor).toBe('2026-10-01T00:00:00.000Z'); // the fresh row, so it does not start from null
    expect(sweep.importFailures).toEqual({ a: 1 });
    expect(sweep.importLease).not.toBe(manual.importLease);

    // The older run (the manual one) finishes LAST: its lease is gone, so its write is dropped.
    expect(await saveImportState(db, manual, { cursor: '2026-09-01T00:00:00.000Z', resumePage: 9, pendingCursor: null, failures: {} })).toBe(false);
    expect(await column(1, 'p1', 'import_cursor')).toBe('2026-10-01T00:00:00.000Z');
    expect(await column(1, 'p1', 'import_resume_page')).toBeNull();

    // …and the holder of the newest lease still saves.
    expect(await saveImportState(db, sweep, { cursor: '2026-10-02T00:00:00.000Z', resumePage: null, pendingCursor: null, failures: {} })).toBe(true);
    expect(await column(1, 'p1', 'import_cursor')).toBe('2026-10-02T00:00:00.000Z');
  });

  it('a touch of a row that is gone returns null, and a re-read sees a replaced external id', async () => {
    await publish(1, 'p1', 'acme');
    const row = await only(1, 'p1');
    await pg.query(`UPDATE job_posting_distributions SET external_id = 'REAL-1', board_filter_id = NULL WHERE tenant_id = 1`);
    expect((await readPostedDistribution(db, row))?.externalId).toBe('REAL-1');
    await pg.query(`DELETE FROM job_posting_distributions`);
    expect(await touchPostedDistribution(db, row)).toBeNull();
    expect(await readPostedDistribution(db, row)).toBeNull();
  });
});

describe('the candidate-ref salt', () => {
  it('two getters on a new tenant get the SAME salt, stored once; another tenant gets its own', async () => {
    const [a, b] = await Promise.all([loadRefSalt(db, 1), loadRefSalt(db, 1)]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    clearRefSaltCache(); // a fresh isolate: it must read the stored one, not mint another
    expect(await loadRefSalt(db, 1)).toBe(a);
    expect((await pg.query('SELECT 1 FROM hiring_ref_salts WHERE tenant_id = 1')).rows).toHaveLength(1);

    const other = await loadRefSalt(db, 2);
    expect(other).not.toBe(a);
    expect((await pg.query<{ salt: string }>('SELECT salt FROM hiring_ref_salts WHERE tenant_id = 2')).rows[0]!.salt).toBe(other);
  });

  it('migration 1334 applies cleanly twice, refuses a salt for no tenant, and deletes with its tenant', async () => {
    await loadRefSalt(db, 1);
    await pg.exec(migration('1334_hiring_ref_salts_tenant_cascade.sql'));
    await pg.exec(migration('1334_hiring_ref_salts_tenant_cascade.sql')); // idempotent
    await expect(pg.query(`INSERT INTO hiring_ref_salts (tenant_id, salt) VALUES (999, 'x')`)).rejects.toThrow();
    await pg.exec('DELETE FROM tenants WHERE id = 1');
    expect((await pg.query('SELECT 1 FROM hiring_ref_salts WHERE tenant_id = 1')).rows).toHaveLength(0);
  });

  it('migration 1334 removes a salt whose tenant is already gone before adding the constraint', async () => {
    await pg.exec('ALTER TABLE hiring_ref_salts DROP CONSTRAINT IF EXISTS hiring_ref_salts_tenant_id_fkey'); // the table as 1332 left it
    await pg.query(`INSERT INTO hiring_ref_salts (tenant_id, salt) VALUES (999, 'orphan'), (2, 'kept')`);
    await pg.exec(migration('1334_hiring_ref_salts_tenant_cascade.sql'));
    expect((await pg.query<{ tenant_id: number }>('SELECT tenant_id FROM hiring_ref_salts')).rows.map((r) => r.tenant_id)).toEqual([2]);
  });
});

describe('the tenant-board worklist rotates', () => {
  const keys = async (limit: number) => (await listTenantBoardKeys(db, ['greenhouse-job-board'], limit)).map((b) => `${b.tenantId}:${b.connectorKey}`);

  it('orders by the oldest check in each (tenant, key) group — never-checked first — THEN limits', async () => {
    await publish(1, 'p1', 'own-a', { checked: '2026-11-08 10:00:00' }); // checked just now
    await publish(2, 'p2', 'own-b', { checked: '2026-10-01 00:00:00' }); // checked long ago
    await publish(3, 'p3', 'own-c', { checked: '2026-09-01 00:00:00' }); // checked longest ago
    await publish(1, 'p4', 'own-a'); // the group of tenant 1 ALSO holds a never-checked row: it leads
    await publish(1, 'p5', 'greenhouse-job-board'); // a built-in is excluded

    expect(await keys(10)).toEqual(['1:own-a', '3:own-c', '2:own-b']);
    expect(await keys(1)).toEqual(['1:own-a']); // the limit takes the head of the ORDER, not an arbitrary few
    // After the first group is served (its rows touched), the next call moves on.
    await pg.query(`UPDATE job_posting_distributions SET import_checked_at = '2026-11-08 11:00:00' WHERE tenant_id = 1`);
    expect(await keys(2)).toEqual(['3:own-c', '2:own-b']);
    expect(await keys(3)).toEqual(['3:own-c', '2:own-b', '1:own-a']);
  });

  it('a non-importable group the sweep has visited no longer sorts first', async () => {
    await publish(1, 'p1', 'link-only'); // never imported, so never checked: sorts first forever
    await publish(2, 'p2', 'own-b', { checked: '2026-10-01 00:00:00' });
    expect(await keys(1)).toEqual(['1:link-only']);

    await touchNonImportableBoard(db, { tenantId: 1, connectorKey: 'link-only' });
    expect(await keys(1)).toEqual(['2:own-b']);
    expect(await keys(2)).toEqual(['2:own-b', '1:link-only']);
  });
});

describe('the link-finding pass has its own rotation key', () => {
  it('touchResolveAttempt moves resolve_retry_at and never import_checked_at; resolving clears the error and back-off', async () => {
    await publish(1, 'p1', 'acme', { checked: '2026-10-01 00:00:00' });
    await pg.query(`UPDATE job_posting_distributions SET last_error = 'collided'`);
    const row = await only(1, 'p1');

    await touchResolveAttempt(db, row);
    expect(await column(1, 'p1', `import_checked_at::text`)).toBe('2026-10-01 00:00:00');
    expect(await column(1, 'p1', 'resolve_retry_at IS NOT NULL')).toBe(true);

    await recordResolvedLink(db, row, { url: 'https://acme.test/jobs/1', externalId: 'REAL-1' });
    expect(await column(1, 'p1', 'url')).toBe('https://acme.test/jobs/1');
    expect(await column(1, 'p1', 'last_error')).toBeNull();
    expect(await column(1, 'p1', 'resolve_retry_at')).toBeNull();
    expect(await column(1, 'p1', 'import_checked_at::text')).toBe('2026-10-01 00:00:00');
  });

  it('a row that was tried waits out its back-off while an untried one is served first', async () => {
    await publish(1, 'p1', 'acme');
    await publish(2, 'p2', 'acme');
    await touchResolveAttempt(db, await only(1, 'p1'));
    const rows = await listPostedDistributionsForSweep(db, 10, { missingUrlOnly: true, connectorKeys: ['acme'] });
    expect(rows.map((r) => r.postingId)).toEqual(['p2']); // p1 is inside its retry window
  });
});
