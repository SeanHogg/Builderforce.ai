/**
 * Migration 1344 + the run-delta writer against REAL Postgres (PGlite), executed from its file. Pins what an
 * in-memory double cannot:
 *  - the client id a delta syncs under (`stableEntityId`, version nibble 8) is a value Postgres' `uuid` accepts —
 *    `sync_records` / `sync_entity_mappings.client_entity_id` are `uuid` columns;
 *  - the row ids are `uuid` (gen_random_uuid), and a second delta under one (tenant, run, repo key) is `exists`
 *    with the stored digest;
 *  - the writer's NESTED SAVEPOINT: a row Postgres refuses rolls back to it and the outer (push) transaction stays
 *    usable — the next event in the same batch still commits.
 *
 * PGlite ships no pgvector, so the file runs with `vector(1024)` read as `text` and its HNSW index left out; every
 * other statement (tables, keys, indexes, autovacuum settings) runs as written.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '../../infrastructure/database/connection';
import { pgErrorOf } from '../../infrastructure/database/uniqueViolation';
import { readRunDeltaRecord, type ImportedRunDelta } from '../../domain/runDelta/runDeltaRecord';
import { delta, ENTITY, payload } from '../sync/importers/__fixtures__/runDeltaFixture';
import { runDeltaWriter } from './runDeltaStore';

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const MIGRATION = readFileSync(fileURLToPath(new URL('../../../migrations/1344_run_deltas.sql', import.meta.url).href), 'utf8')
  .replace(/vector\(1024\)/g, 'text')
  .replace(/CREATE INDEX IF NOT EXISTS run_delta_findings_embedding_hnsw[\s\S]*?;/, '');

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec('CREATE TABLE tenants (id integer PRIMARY KEY); INSERT INTO tenants (id) VALUES (7);');
  await pg.exec(MIGRATION);
  db = drizzle(pg);
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => { await pg.exec('DELETE FROM run_deltas'); });

/** The fixture delta as the importer reduces it; `runId` re-keys it (the writer keys by the summary's run). */
function imported(runId?: string): ImportedRunDelta {
  const parsed = readRunDeltaRecord(payload({ projectId: 5 }, delta()), ENTITY, '2026-01-01T00:00:00.000Z', (raw) => new Date(String(raw)));
  if (!parsed.ok) throw new Error(parsed.detail);
  return runId ? { ...parsed.value, summary: { ...parsed.value.summary, runId } } : parsed.value;
}

const inTx = <T>(work: (tx: Tx) => Promise<T>): Promise<T> => db.transaction((tx) => work(tx as unknown as Tx));

describe('migration 1344 + runDeltaWriter (PGlite)', () => {
  it('re-runs cleanly (expand only, idempotent)', async () => {
    await expect(pg.exec(MIGRATION)).resolves.toBeDefined();
  });

  it('Postgres accepts the stableEntityId client id as a uuid', async () => {
    const { rows } = await pg.query<{ id: string }>('SELECT $1::uuid AS id', [ENTITY]);
    expect(rows[0]?.id).toBe(ENTITY);
  });

  it('writes the delta, its dimensions and findings under uuid ids; a second write of the key is `exists`', async () => {
    const value = imported();
    expect(await inTx((tx) => runDeltaWriter(tx).insert(7, 5, value))).toEqual({ status: 'inserted' });
    const { rows } = await pg.query<{ id: string; project_id: number; digest: string }>('SELECT id, project_id, digest FROM run_deltas');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect((await pg.query('SELECT 1 FROM run_delta_dimensions')).rows).toHaveLength(2);
    expect((await pg.query('SELECT 1 FROM run_delta_findings')).rows).toHaveLength(3);
    expect(await inTx((tx) => runDeltaWriter(tx).insert(7, 5, value))).toEqual({ status: 'exists', digest: value.delta.digest });
  });

  it('a row Postgres refuses rolls back to the writer\'s savepoint; the outer transaction still commits the next delta', async () => {
    const good = imported();
    const bad: ImportedRunDelta = { ...imported('run-bad'), findings: [{ ...good.findings[0]!, cardText: 'nul\u0000here' }] };
    let refused: unknown;
    await inTx(async (tx) => {
      const writer = runDeltaWriter(tx);
      await writer.insert(7, null, bad).catch((error: unknown) => { refused = error; });
      expect(await writer.insert(7, 5, good)).toEqual({ status: 'inserted' });
    });
    expect(pgErrorOf(refused)?.code).toMatch(/^22/); // what the importer answers `run_delta_unstorable`
    const { rows } = await pg.query<{ run_id: string }>('SELECT run_id FROM run_deltas');
    expect(rows.map((r) => r.run_id)).toEqual([good.summary.runId]); // nothing of the refused delta survived
  });
});
