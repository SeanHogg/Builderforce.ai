/**
 * Migration 1339 (typed-entity-ids §4, expand only) against REAL Postgres (PGlite), executed from
 * its file: `sync_entity_mappings.sync_id` is added, backfilled from decimal `server_id` text
 * only, never for a run step (a `message` whose id is a `brain_chat_steps` id >= STEP_ID_FLOOR),
 * and indexed by a PLAIN (non-unique) index. The Drizzle schema declares the same column/index.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { STEP_ID_FLOOR } from '../database/schema/canvas';
import { syncEntityMappings } from '../database/schema/sync';

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../../migrations/1339_sync_entity_mappings_sync_id.sql', import.meta.url).href),
  'utf8',
);

/** `sync_entity_mappings` as 1247 created it, minus the FK and the columns 1339 does not touch. */
const BASE_TABLE = `CREATE TABLE sync_entity_mappings (
  id bigserial PRIMARY KEY,
  tenant_id integer NOT NULL,
  entity_type varchar(40) NOT NULL,
  client_entity_id uuid NOT NULL,
  server_id varchar(128) NOT NULL
);`;

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const STEP_ID = String(STEP_ID_FLOOR + 7);

/** [entity_type, server_id, expected sync_id after the backfill]. */
const ROWS: Array<[string, string, number | null]> = [
  ['ticket', '42', 42],
  ['project', '7', 7],
  ['message', '77', 77],
  ['message', STEP_ID, null],
  ['usage', uuid(900), null],
  ['execution', uuid(901), null],
  ['ticket', 'roadmap:abc', null],
  ['ticket', '0', null],
  ['ticket', '042', null],
  ['chat', '9007199254740991', null],
];

let pg: PGlite;

async function syncIds(): Promise<Array<{ server_id: string; sync_id: string | number | null }>> {
  const result = await pg.query<{ server_id: string; sync_id: string | number | null }>(
    'SELECT server_id, sync_id FROM sync_entity_mappings ORDER BY id',
  );
  return result.rows;
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(BASE_TABLE);
  for (const [index, [entityType, serverId]] of ROWS.entries()) {
    await pg.query(
      'INSERT INTO sync_entity_mappings (tenant_id, entity_type, client_entity_id, server_id) VALUES ($1, $2, $3, $4)',
      [7, entityType, uuid(index + 1), serverId],
    );
  }
  await pg.exec(MIGRATION);
});

afterAll(async () => { await pg.close(); });

describe('1339 sync_entity_mappings.sync_id', () => {
  it('backfills decimal server ids only, never a run step, a UUID, a "kind:ref" or a non-canonical number', async () => {
    const rows = await syncIds();
    expect(rows.map((r) => [r.server_id, r.sync_id === null ? null : Number(r.sync_id)]))
      .toEqual(ROWS.map(([, serverId, expected]) => [serverId, expected]));
  });

  it('keeps server_id exactly as it was (mirror and usage rows are untouched)', async () => {
    expect((await syncIds()).map((r) => r.server_id)).toEqual(ROWS.map(([, serverId]) => serverId));
  });

  it('re-applies cleanly and does not overwrite a sync_id the Worker already wrote', async () => {
    await pg.query("UPDATE sync_entity_mappings SET sync_id = 4242 WHERE server_id = '42'");
    await pg.exec(MIGRATION);
    const rows = await syncIds();
    expect(Number(rows.find((r) => r.server_id === '42')?.sync_id)).toBe(4242);
    await pg.query("UPDATE sync_entity_mappings SET sync_id = 42 WHERE server_id = '42'");
  });

  it('indexes (tenant_id, entity_type, sync_id) with a PLAIN index: one SyncId may map to several client ids', async () => {
    const index = await pg.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_sync_entity_mappings_sync_id'",
    );
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0]?.indexdef).not.toMatch(/UNIQUE/i);
    expect(index.rows[0]?.indexdef).toMatch(/\(tenant_id, entity_type, sync_id\)/);
    await pg.query(
      "INSERT INTO sync_entity_mappings (tenant_id, entity_type, client_entity_id, server_id, sync_id) VALUES (7, 'ticket', $1, '42', 42)",
      [uuid(999)],
    );
    const twins = await pg.query("SELECT 1 FROM sync_entity_mappings WHERE entity_type = 'ticket' AND sync_id = 42");
    expect(twins.rows).toHaveLength(2);
  });

  it('is the column and index the Drizzle schema declares: nullable bigint, non-unique index', () => {
    const column = getTableColumns(syncEntityMappings).syncId;
    expect(column.name).toBe('sync_id');
    expect(column.columnType).toBe('PgBigInt53');
    expect(column.notNull).toBe(false);
    const index = getTableConfig(syncEntityMappings).indexes.find((i) => i.config.name === 'idx_sync_entity_mappings_sync_id');
    expect(index?.config.unique).toBe(false);
    expect(index?.config.columns.map((c) => (c as { name: string }).name)).toEqual(['tenant_id', 'entity_type', 'sync_id']);
  });
});
