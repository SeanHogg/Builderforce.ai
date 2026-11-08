/**
 * The sync pull SQL against REAL Postgres (PGlite): migration 1304 is executed from its file, and the pull
 * statements are the ones `createSyncPullStore` issues (the repository function runs against a drizzle/PGlite
 * handle; nothing here re-types the SQL).
 *
 * What this proves: migration 1304 applies (and re-applies) and leaves the `txid` default and the index; the
 * `xid8` casts and the `(txid, seq) > ($xid8, $bigint)` tuple filter parse and compare as intended (including a
 * txid beyond 2^53); rows are ordered by (txid, seq) — commit order — not by seq; a destination/tenant filter
 * holds; `xmin` comes back on an EMPTY page; `xmin_age` is computed and reported; and a row of a transaction that
 * is still OPEN is excluded by `txid < xmin` while it is open and delivered after it commits.
 *
 * What PGlite CANNOT prove: true cross-connection concurrency. It is ONE session, so two transactions never
 * overlap from different connections. The "open transaction" case below holds BEGIN open on the same session and
 * queries inside it (its own row is visible to it, yet withheld by `txid < xmin`); other sessions' snapshots, lock
 * waits, deadlocks and the `xmin` age under a genuinely long foreign transaction are NOT exercised.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { decodeSyncCursor, encodeSyncCursor } from '../../domain/sync/cursorCodec';
import { WATERMARK_ORIGIN, compareWatermark } from '../../domain/sync/deltaWatermark';
import type { Db } from '../database/connection';
import { isUniqueViolation, pgErrorOf } from '../database/uniqueViolation';
import { createSyncPullStore } from './SyncPullRepository';

vi.mock('../../application/observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const migration = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url).href), 'utf8');

let pg: PGlite;
let db: Db;

/** `sync_changes` as 1247 created it, minus the FK and columns neither the pull nor 1304 touch. */
const BASE_TABLE = `CREATE TABLE sync_changes (
  seq bigserial PRIMARY KEY,
  tenant_id integer NOT NULL,
  destination_key text NOT NULL,
  record jsonb NOT NULL
);`;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(BASE_TABLE);
  // Rows that exist BEFORE the migration (destination 'legacy'), written by the previous Worker.
  await pg.exec(`INSERT INTO sync_changes (seq, tenant_id, destination_key, record) VALUES
    (901, 7, 'legacy', '{"id":"old-1"}'), (902, 7, 'legacy', '{"id":"old-2"}')`);
  await pg.exec(migration('1304_sync_changes_commit_watermark.sql'));
  db = drizzle(pg) as unknown as Db;
});

afterAll(async () => { await pg.close(); });

beforeEach(async () => {
  // A statement that failed inside an open BEGIN must not poison the next test.
  await pg.exec('ROLLBACK');
  await pg.exec(`DELETE FROM sync_changes WHERE destination_key <> 'legacy'`);
  vi.mocked(reportCaughtError).mockClear();
});

/** One row in its OWN transaction (autocommit), with an explicit seq so seq order can differ from commit order. */
const insert = (seq: number, id: string, tenant = 7, destination = 'k') =>
  pg.exec(`INSERT INTO sync_changes (seq, tenant_id, destination_key, record) VALUES (${seq}, ${tenant}, '${destination}', '{"id":"${id}"}')`);

const ids = (rows: Array<{ record: unknown }>) => rows.map((r) => (r.record as { id: string }).id);

describe('migration 1304', () => {
  it('applies from its file, is re-runnable, and leaves the xid8 default and the watermark index', async () => {
    await pg.exec(migration('1304_sync_changes_commit_watermark.sql'));
    const column = await pg.query<{ column_default: string; data_type: string; is_nullable: string }>(
      `SELECT column_default, udt_name AS data_type, is_nullable FROM information_schema.columns
       WHERE table_name = 'sync_changes' AND column_name = 'txid'`,
    );
    expect(column.rows[0]).toMatchObject({ data_type: 'xid8', is_nullable: 'NO' });
    expect(column.rows[0]?.column_default).toContain('pg_current_xact_id');
    const index = await pg.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_sync_changes_destination_txid'`,
    );
    expect(index.rows[0]?.indexdef).toContain('(tenant_id, destination_key, txid, seq)');
  });

  it('fills txid from the writing transaction: increasing across transactions, equal inside one', async () => {
    await insert(1, 'a');
    await insert(2, 'b');
    // Explicit seqs: the bigserial would start at 1 and collide with the explicit-seq rows above.
    await pg.exec(`BEGIN; INSERT INTO sync_changes (seq, tenant_id, destination_key, record) VALUES (3, 7, 'k', '{"id":"c"}'),
      (4, 7, 'k', '{"id":"d"}'); COMMIT;`);
    const { rows } = await pg.query<{ id: string; txid: string }>(`SELECT record->>'id' AS id, txid::text AS txid FROM sync_changes ORDER BY seq`);
    const tx = Object.fromEntries(rows.map((r) => [r.id, BigInt(r.txid)]));
    expect(tx.a! < tx.b!).toBe(true);
    expect(tx.b! < tx.c!).toBe(true);
    expect(tx.c).toBe(tx.d);
  });
});

describe('the pull query (SyncPullRepository.changesAfter)', () => {
  it('orders by (txid, seq) — commit order — not by seq, scoped to tenant and destination', async () => {
    await insert(20, 'a'); // committed FIRST, higher seq
    await insert(10, 'b'); // committed LATER, lower seq
    await insert(30, 'other-destination', 7, 'x');
    await insert(40, 'other-tenant', 8);
    const page = await createSyncPullStore(db).changesAfter(7, 'k', WATERMARK_ORIGIN, 10);
    expect(ids(page.rows)).toEqual(['a', 'b']);
    expect(page.rows.map((r) => r.seq)).toEqual([20, 10]);
    expect(page.rows.every((r) => typeof r.txid === 'string')).toBe(true);
    expect(compareWatermark(page.rows[0]!, page.rows[1]!)).toBeLessThan(0);
  });

  it('applies the (txid, seq) > ($xid8, $bigint) cursor filter and the limit', async () => {
    await insert(20, 'a');
    await insert(10, 'b');
    const store = createSyncPullStore(db);
    const all = (await store.changesAfter(7, 'k', WATERMARK_ORIGIN, 10)).rows;
    const [a, b] = all;
    expect(ids((await store.changesAfter(7, 'k', WATERMARK_ORIGIN, 1)).rows)).toEqual(['a']);
    expect(ids((await store.changesAfter(7, 'k', { txid: a!.txid, seq: a!.seq }, 10)).rows)).toEqual(['b']);
    // Same txid, lower seq than the row: the row itself is after it; a higher seq excludes it.
    expect(ids((await store.changesAfter(7, 'k', { txid: a!.txid, seq: a!.seq - 1 }, 10)).rows)).toEqual(['a', 'b']);
    expect(ids((await store.changesAfter(7, 'k', { txid: b!.txid, seq: b!.seq }, 10)).rows)).toEqual([]);
  });

  it('returns xmin on an EMPTY page, above every committed txid when nothing is open', async () => {
    await insert(1, 'a');
    const store = createSyncPullStore(db);
    const [row] = (await store.changesAfter(7, 'k', WATERMARK_ORIGIN, 10)).rows;
    const empty = await store.changesAfter(7, 'k', { txid: row!.txid, seq: row!.seq }, 10);
    expect(empty.rows).toEqual([]);
    expect(BigInt(empty.xmin) > BigInt(row!.txid)).toBe(true);
    expect(BigInt((await store.databaseXmin())) >= BigInt(empty.xmin)).toBe(true);
  });

  it('computes xmin_age and reports it through the caught-error seam past the threshold', async () => {
    await insert(1, 'a');
    await createSyncPullStore(db, { xminWarnAge: -1 }).changesAfter(7, 'k', WATERMARK_ORIGIN, 10);
    const [, details] = vi.mocked(reportCaughtError).mock.calls[0]!;
    expect(details).toMatchObject({ operation: 'syncPull:xminHeldBack', level: 'warning' });
    const age = (details.context as { xminAge: number }).xminAge;
    expect(Number.isInteger(age) && age >= 0).toBe(true);
    // Under the real default threshold a fresh database is quiet.
    vi.mocked(reportCaughtError).mockClear();
    await createSyncPullStore(db).changesAfter(7, 'k', WATERMARK_ORIGIN, 10);
    expect(reportCaughtError).not.toHaveBeenCalled();
  });

  it('withholds a row whose transaction is still open (txid < xmin), then delivers it once committed', async () => {
    await insert(1, 'a');
    const store = createSyncPullStore(db);
    await pg.exec(`BEGIN; INSERT INTO sync_changes (seq, tenant_id, destination_key, record) VALUES (2, 7, 'k', '{"id":"open"}')`);
    try {
      // Same session: the open transaction's own row is visible to its queries, yet withheld by the xmin bound.
      const visible = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM sync_changes WHERE seq = 2`);
      expect(visible.rows[0]?.n).toBe(1);
      const during = await store.changesAfter(7, 'k', WATERMARK_ORIGIN, 10);
      expect(ids(during.rows)).toEqual(['a']);
      const open = await pg.query<{ txid: string }>(`SELECT txid::text AS txid FROM sync_changes WHERE seq = 2`);
      expect(during.xmin).toBe(open.rows[0]!.txid);
    } finally {
      await pg.exec('COMMIT');
    }
    const after = await store.changesAfter(7, 'k', WATERMARK_ORIGIN, 10);
    expect(ids(after.rows)).toEqual(['a', 'open']);
  });
});

describe('rows that predate the migration, and minChangeWatermark', () => {
  it('backfills pre-existing rows with txid 0, ordered by seq, ahead of every later row', async () => {
    const { rows } = await pg.query<{ id: string; txid: string }>(
      `SELECT record->>'id' AS id, txid::text AS txid FROM sync_changes WHERE destination_key = 'legacy' ORDER BY seq`,
    );
    expect(rows).toEqual([{ id: 'old-1', txid: '0' }, { id: 'old-2', txid: '0' }]);
    // A NEW row gets a real txid even though its seq is LOWER than the old rows' would continue from.
    await insert(0, 'new', 7, 'legacy');
    const page = await createSyncPullStore(db).changesAfter(7, 'legacy', WATERMARK_ORIGIN, 10);
    expect(ids(page.rows)).toEqual(['old-1', 'old-2', 'new']);
    expect(page.rows.map((r) => r.txid)[0]).toBe('0');
    expect(BigInt(page.rows[2]!.txid) > 0n).toBe(true);
    // A legacy cursor (0, S) resumes after the old rows by seq and still delivers the real-txid row.
    expect(ids((await createSyncPullStore(db).changesAfter(7, 'legacy', { txid: '0', seq: 902 }, 10)).rows)).toEqual(['new']);
  });

  it('minChangeWatermark is the first row in (txid, seq) order for the destination, null when none', async () => {
    const store = createSyncPullStore(db);
    expect(await store.minChangeWatermark(7, 'legacy')).toEqual({ txid: '0', seq: 901 });
    await insert(20, 'a');
    await insert(10, 'b'); // later transaction, lower seq: not the minimum
    const min = await store.minChangeWatermark(7, 'k');
    const first = (await store.changesAfter(7, 'k', WATERMARK_ORIGIN, 10)).rows[0]!;
    expect(min).toEqual({ txid: first.txid, seq: 20 });
    expect(await store.minChangeWatermark(7, 'nobody')).toBeNull();
    expect(await store.minChangeWatermark(99, 'k')).toBeNull();
  });
});

describe('a real unique violation through drizzle', () => {
  it('is recognised by isUniqueViolation (the driver error is wrapped on .cause)', async () => {
    await pg.exec(`CREATE TABLE IF NOT EXISTS uq_probe (id integer, CONSTRAINT uq_probe_id UNIQUE (id))`);
    await db.execute(sql`INSERT INTO uq_probe (id) VALUES (1)`);
    const error = await db.execute(sql`INSERT INTO uq_probe (id) VALUES (1)`).then(() => undefined, (e: unknown) => e);
    expect(error).toBeDefined();
    expect(pgErrorOf(error)?.code).toBe('23505');
    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(error, 'uq_probe_id')).toBe(true);
    expect(isUniqueViolation(error, 'uq_sync_events_event')).toBe(false);
  });
});

describe('the v2 cursor and the ::xid8 cast', () => {
  it('round-trips the txid string, including one beyond 2^53 and the 64-bit maximum, through the cast', async () => {
    await insert(1, 'a');
    const store = createSyncPullStore(db);
    for (const txid of ['9007199254740993', '18446744073709551615']) {
      const cursor = encodeSyncCursor({ v: 2, kind: 'delta', txid, seq: 5, issuedAt: 1_000 });
      const decoded = decodeSyncCursor(cursor);
      expect(decoded).toMatchObject({ v: 2, kind: 'delta', txid, seq: 5 });
      const position = { txid: (decoded as { txid: string }).txid, seq: 5 };
      // Past every real txid: nothing is after it, and the cast neither rounds nor rejects it.
      expect((await store.changesAfter(7, 'k', position, 10)).rows).toEqual([]);
      const echoed = await pg.query<{ t: string }>(`SELECT '${position.txid}'::xid8::text AS t`);
      expect(echoed.rows[0]?.t).toBe(txid);
    }
  });

  it('feeds a row\'s own txid string back as the cursor without loss', async () => {
    await insert(1, 'a');
    await insert(2, 'b');
    const store = createSyncPullStore(db);
    const first = (await store.changesAfter(7, 'k', WATERMARK_ORIGIN, 1)).rows[0]!;
    const cursor = decodeSyncCursor(encodeSyncCursor({ v: 2, kind: 'delta', txid: first.txid, seq: first.seq, issuedAt: 1_000 })) as
      { txid: string; seq: number };
    expect(ids((await store.changesAfter(7, 'k', { txid: cursor.txid, seq: cursor.seq }, 10)).rows)).toEqual(['b']);
  });
});
