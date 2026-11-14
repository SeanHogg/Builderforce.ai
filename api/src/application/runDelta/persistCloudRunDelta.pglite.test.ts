/**
 * PRD 41 §C14 "Cloud runs" — `persistCloudRunDelta` against REAL Postgres (PGlite), executed from
 * its file. Pins what an in-memory double cannot:
 *  - a cloud run's delta lands in `run_deltas` (+ dimensions/findings) under its (run, repo key),
 *    and a RETRIED finalize converges (revises to the same digest), never wedges on the unique key;
 *  - the `run-delta` mirror record (`sync_records` projection + `sync_changes` row) is written
 *    under the canonical client id, so a pull of this destination syncs the FULL delta payload to
 *    the workspace — the same id a locally-run device would push, so nothing double-stores;
 *  - a different digest already under the key is left alone (the first write wins).
 *
 * PGlite ships no pgvector, so the file runs with `vector(1024)` read as `text` and its HNSW index
 * left out; every other statement runs as written. The sync tables are created inline (the pull
 * path's shape), as in `SyncPullRepository`'s tests.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDeltaClientId } from '../../domain/runDelta/runDeltaRecord';
import { delta, payload, REPO_KEY, RUN_ID } from '../sync/importers/__fixtures__/runDeltaFixture';
import { repositoryIdentityOf } from '../../domain/runOutcomes/repositoryIdentity';
import { cloudRunId } from '../../domain/execution/cloudRunId';
import { persistCloudRunDelta } from './persistCloudRunDelta';
import { runDeltaEvidenceKey, type EvidenceBucket } from './runDeltaEvidence';

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

/** The persist hands the evidence store `env.UPLOADS`; an in-memory double satisfies it. */
function uploadsEnv(): { env: { UPLOADS: unknown }; objects: Map<string, string> } {
  const objects = new Map<string, string>();
  const bucket: EvidenceBucket = {
    head: async (key) => (objects.has(key) ? {} : null),
    put: async (key, value) => { objects.set(key, value); return {}; },
    get: async (key) => {
      const text = objects.get(key);
      return text === undefined ? null : { json: async <T>() => JSON.parse(text) as T };
    },
  };
  return { env: { UPLOADS: bucket }, objects };
}

const MIGRATION = readFileSync(fileURLToPath(new URL('../../../migrations/1344_run_deltas.sql', import.meta.url).href), 'utf8')
  .replace(/vector\(1024\)/g, 'text')
  .replace(/CREATE INDEX IF NOT EXISTS run_delta_findings_embedding_hnsw[\s\S]*?;/, '');

/** The minimal `sync_records` / `sync_changes` shape the pull reads (no vector, no txid backfill). */
const SYNC_TABLES = `
CREATE TABLE IF NOT EXISTS tenants (id integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS sync_records (
  id bigserial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type varchar(40) NOT NULL,
  client_entity_id uuid NOT NULL,
  server_id varchar(128) NOT NULL,
  schema_version integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  destination_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  payload jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash varchar(128) NOT NULL,
  UNIQUE (tenant_id, entity_type, client_entity_id)
);
CREATE TABLE IF NOT EXISTS sync_changes (
  seq bigserial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type varchar(40) NOT NULL,
  client_entity_id uuid NOT NULL,
  server_id varchar(128) NOT NULL,
  operation varchar(16) NOT NULL,
  version integer NOT NULL,
  destination_key text NOT NULL,
  record jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  device_id varchar(128) NOT NULL,
  event_id uuid NOT NULL,
  txid bigint NOT NULL DEFAULT 0 -- migration 1304's xid8 watermark; PGlite has no xid8, the pull keyset reads seq
);
`;

const REPO_CTX = { provider: 'github', host: 'github.com', owner: 'o', repo: 'r', segmentId: 'seg', projectId: 5, repoId: 9, branch: 'bf/1', base: 'main', token: 't' };

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec('CREATE TABLE tenants (id integer PRIMARY KEY); INSERT INTO tenants (id) VALUES (7);');
  await pg.exec(MIGRATION);
  await pg.exec(SYNC_TABLES);
  db = drizzle(pg);
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec('DELETE FROM run_deltas');
  await pg.exec('DELETE FROM sync_records');
  await pg.exec('DELETE FROM sync_changes');
});

describe('persistCloudRunDelta (PGlite)', () => {
  it('persists the delta rows and the mirror record a pull serves; a retried finalize converges', async () => {
    const { env } = uploadsEnv();
    const d = delta();
    const id = await persistCloudRunDelta(db as never, { tenantId: 7, executionId: 42, taskId: 1, repoCtx: REPO_CTX as never, delta: d, env: env as never });
    expect(id).toBe(runDeltaClientId(cloudRunId(42), repositoryIdentityOf(REPO_CTX).slice(0, 128)));

    // run_deltas rows under the (run, repo key).
    const { rows } = await pg.query<{ run_id: string; digest: string }>('SELECT run_id, digest FROM run_deltas');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.run_id).toBe('cloud:42');
    expect(rows[0]!.digest).toBe(d.digest);
    expect((await pg.query('SELECT 1 FROM run_delta_dimensions')).rows).toHaveLength(2);
    expect((await pg.query('SELECT 1 FROM run_delta_findings')).rows).toHaveLength(3);

    // The mirror record: one projection + one change row, FULL payload, server-originated provenance.
    const { rows: recs } = await pg.query<{ entity_type: string; payload: { runId: string; delta: { digest: string } } }>(
      "SELECT entity_type, payload FROM sync_records WHERE entity_type = 'run-delta'",
    );
    expect(recs).toHaveLength(1);
    expect(recs[0]!.payload.runId).toBe('cloud:42');
    expect(recs[0]!.payload.delta.digest).toBe(d.digest);
    const { rows: changes } = await pg.query("SELECT 1 FROM sync_changes WHERE entity_type = 'run-delta'");
    expect(changes).toHaveLength(1);

    // A retried finalize of the SAME delta converges: same record id, still one projection/change row,
    // and the rows still carry the same digest (no wedge on the unique key).
    const id2 = await persistCloudRunDelta(db as never, { tenantId: 7, executionId: 42, taskId: 1, repoCtx: REPO_CTX as never, delta: d, env: env as never });
    expect(id2).toBe(id);
    expect((await pg.query("SELECT 1 FROM sync_records WHERE entity_type = 'run-delta'")).rows).toHaveLength(1);
    expect((await pg.query('SELECT 1 FROM run_deltas')).rows).toHaveLength(1);
  });

  it('a second delta under the key revises the row to its digest (retried finalize that settled)', async () => {
    const { env } = uploadsEnv();
    const first = delta();
    await persistCloudRunDelta(db as never, { tenantId: 7, executionId: 42, taskId: 1, repoCtx: REPO_CTX as never, delta: first, env: env as never });
    // The finalized delta supersedes the first (an L3 analyzer settled): same run + repo key, new digest.
    const revised = delta((b) => { b.dimensions[1]!.verdict = 'same'; });
    await persistCloudRunDelta(db as never, { tenantId: 7, executionId: 42, taskId: 1, repoCtx: REPO_CTX as never, delta: revised, env: env as never });
    const { rows } = await pg.query<{ digest: string }>('SELECT digest FROM run_deltas');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.digest).toBe(revised.digest);
  });

  it('the payload round-trips readRunDeltaRecord (the same shape a device pushes)', async () => {
    const { env } = uploadsEnv();
    const d = delta();
    await persistCloudRunDelta(db as never, { tenantId: 7, executionId: 42, taskId: 1, repoCtx: REPO_CTX as never, delta: d, env: env as never });
    const { rows } = await pg.query<{ payload: unknown }>("SELECT payload FROM sync_records WHERE entity_type = 'run-delta'");
    const { readRunDeltaRecord } = await import('../../domain/runDelta/runDeltaRecord');
    const parsed = readRunDeltaRecord(rows[0]!.payload, runDeltaClientId(cloudRunId(42), repositoryIdentityOf(REPO_CTX).slice(0, 128)), '2026-01-01T00:00:00.000Z', (raw) => new Date(String(raw)));
    expect(parsed.ok).toBe(true);
  });
});
