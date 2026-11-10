/**
 * The run-delta REVISION against REAL Postgres (PGlite, migration 1344 as written — no new migration): the row of
 * (tenant, run, repo key) moves to the new digest and its dimension/finding rows are replaced, in the writer's own
 * savepoint; a key with no row is `missing`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '../../infrastructure/database/connection';
import { readRunDeltaRecord, type ImportedRunDelta } from '../../domain/runDelta/runDeltaRecord';
import type { RunDelta } from '@builderforce/run-delta';
import { delta, ENTITY, finding, payload } from '../sync/importers/__fixtures__/runDeltaFixture';
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

function imported(d: RunDelta): ImportedRunDelta {
  const parsed = readRunDeltaRecord(payload({ projectId: 5 }, d), ENTITY, '2026-01-01T00:00:00.000Z', (raw) => new Date(String(raw)));
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed.value;
}
const inTx = <T>(work: (tx: Tx) => Promise<T>): Promise<T> => db.transaction((tx) => work(tx as unknown as Tx));

describe('runDeltaWriter.revise (PGlite)', () => {
  it('moves the row to the new digest and replaces its dimension and finding rows', async () => {
    const first = imported(delta());
    const final = imported(delta((d) => {
      d.dimensions[1]!.findings = [finding('guard-removed', 'introduced'), finding('secret-leak', 'introduced')];
      d.dimensions[1]!.measuredBy = [{ tool: 'gitleaks', version: '8.18.4', status: 'ok' }];
    }));
    await inTx((tx) => runDeltaWriter(tx).insert(7, 5, first));
    const { rows: before } = await pg.query<{ id: string }>('SELECT id FROM run_deltas');
    expect(await inTx((tx) => runDeltaWriter(tx).revise!(7, 5, final))).toEqual({ status: 'revised' });
    const { rows } = await pg.query<{ id: string; digest: string }>('SELECT id, digest FROM run_deltas');
    expect(rows).toEqual([{ id: before[0]!.id, digest: final.delta.digest }]);
    const { rows: findings } = await pg.query<{ rule_id: string }>('SELECT rule_id FROM run_delta_findings ORDER BY rule_id');
    expect(findings.map((f) => f.rule_id)).toEqual(final.findings.map((f) => f.ruleId).sort());
    expect((await pg.query('SELECT 1 FROM run_delta_dimensions')).rows).toHaveLength(final.dimensions.length);
  });

  it('a key with no row is missing (the importer then inserts it)', async () => {
    expect(await inTx((tx) => runDeltaWriter(tx).revise!(7, 5, imported(delta())))).toEqual({ status: 'missing' });
  });
});
