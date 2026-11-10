/**
 * Migration 1343 + the scope store against REAL Postgres (PGlite): what a review was measured with (PRD 41 §C9) is
 * written with the scope that records its digest, read back on `scopes()` / `scope()`, and moves to `previous_*` with
 * the digest — so Compare's baseline (`previousDigest`) is judged by the versions of THAT review. A row from before the
 * migration reads as unknown (no fields), never as some default.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableColumns } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { knowledgeScopes } from '../../infrastructure/database/schema';
import { drizzleKnowledgeStore } from './knowledgeStore';
import type { KnowledgeStorePort } from './knowledgePorts';

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const migration = (name: string): string => readFileSync(fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url).href), 'utf8');
/** The `knowledge_scopes` table exactly as 1278 creates it (the rest of 1278 touches tables this test has no use for). */
const createScopes = (): string => /CREATE TABLE IF NOT EXISTS knowledge_scopes \([\s\S]*?\n\);/.exec(migration('1278_knowledge_relations.sql'))![0];

let pg: PGlite;
let store: KnowledgeStorePort;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE TABLE tenants (id serial PRIMARY KEY); CREATE TABLE projects (id serial PRIMARY KEY);
    INSERT INTO tenants DEFAULT VALUES; INSERT INTO projects DEFAULT VALUES;`);
  await pg.exec(createScopes());
  for (const m of ['1279_knowledge_scope_previous_digest.sql', '1294_knowledge_scope_provenance.sql', '1343_knowledge_scope_measured_with.sql']) await pg.exec(migration(m));
  store = drizzleKnowledgeStore(drizzle(pg) as unknown as Db, 1, 1);
});

afterAll(async () => { await pg.close(); });
beforeEach(async () => { await pg.exec('DELETE FROM knowledge_scopes'); });

const ROOT = 'ws:a';
const V5 = { extractorVersion: '5', toolVersions: { knip: '5.30.0', jscpd: '4.0.5' } };
const V6 = { extractorVersion: '6', toolVersions: { knip: '5.31.0', jscpd: '4.0.5' } };
const review = (digest: string | undefined, measured: Partial<typeof V5> = {}) =>
  store.upsertScope({ rootId: ROOT, title: 'A', packs: ['code'], ...(digest ? { lastDigest: digest } : {}), ...measured });

describe('migration 1343', () => {
  it('re-runs cleanly (expand only, idempotent)', async () => {
    await expect(pg.exec(migration('1343_knowledge_scope_measured_with.sql'))).resolves.toBeDefined();
  });

  it('adds four nullable columns, no defaults, matching the Drizzle schema', async () => {
    const cols = (await pg.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_name = 'knowledge_scopes' AND column_name IN ('extractor_version', 'tool_versions', 'previous_extractor_version', 'previous_tool_versions')
       ORDER BY column_name`)).rows;
    expect(cols).toEqual([
      { column_name: 'extractor_version', data_type: 'character varying', is_nullable: 'YES', column_default: null },
      { column_name: 'previous_extractor_version', data_type: 'character varying', is_nullable: 'YES', column_default: null },
      { column_name: 'previous_tool_versions', data_type: 'jsonb', is_nullable: 'YES', column_default: null },
      { column_name: 'tool_versions', data_type: 'jsonb', is_nullable: 'YES', column_default: null },
    ]);
    const schema = getTableColumns(knowledgeScopes);
    expect([schema.extractorVersion.name, schema.toolVersions.name, schema.previousExtractorVersion.name, schema.previousToolVersions.name])
      .toEqual(['extractor_version', 'tool_versions', 'previous_extractor_version', 'previous_tool_versions']);
    for (const c of [schema.extractorVersion, schema.toolVersions, schema.previousExtractorVersion, schema.previousToolVersions]) expect(c.notNull).toBe(false);
  });
});

describe('scope store: what a review was measured with (PRD 41 §C9)', () => {
  it('round-trips the values written with a review digest', async () => {
    await review('d1', V5);
    expect(await store.scope(ROOT)).toMatchObject({ lastDigest: 'd1', ...V5 });
    expect((await store.scopes())[0]).toMatchObject({ lastDigest: 'd1', ...V5 });
  });

  it('moves them to previous_* with the digest, so the baseline is judged by ITS review', async () => {
    await review('d1', V5);
    await review('d2', V6);
    expect(await store.scope(ROOT)).toMatchObject({
      lastDigest: 'd2', ...V6, previousDigest: 'd1', previousExtractorVersion: '5', previousToolVersions: V5.toolVersions,
    });
  });

  it('a re-sent final chunk (same digest) moves nothing; one without the values keeps what is stored', async () => {
    await review('d1', V5);
    await review('d2', V6);
    await review('d2');
    expect(await store.scope(ROOT)).toMatchObject({ lastDigest: 'd2', ...V6, previousDigest: 'd1', previousExtractorVersion: '5' });
  });

  it('a new review that states none is unknown — never the previous review\'s values', async () => {
    await review('d1', V5);
    await review('d2');
    const s = await store.scope(ROOT);
    expect(s).not.toHaveProperty('extractorVersion');
    expect(s).not.toHaveProperty('toolVersions');
    expect(s).toMatchObject({ previousDigest: 'd1', ...{ previousExtractorVersion: '5', previousToolVersions: V5.toolVersions } });
  });

  it('a scope write without a digest (held back) stores none and changes none', async () => {
    await review(undefined, V5);
    expect(await store.scope(ROOT)).not.toHaveProperty('extractorVersion');
    await review('d1', V5);
    await review(undefined, V6);
    expect(await store.scope(ROOT)).toMatchObject({ lastDigest: 'd1', ...V5 });
  });

  it('a row from before the migration (NULL columns) reads as unknown: no fields at all', async () => {
    await pg.exec(`INSERT INTO knowledge_scopes (tenant_id, project_id, root_id, title, packs, last_digest, previous_digest)
      VALUES (1, 1, '${ROOT}', 'A', ARRAY['code'], 'd2', 'd1')`);
    const s = await store.scope(ROOT);
    expect(s).toMatchObject({ lastDigest: 'd2', previousDigest: 'd1' });
    for (const k of ['extractorVersion', 'toolVersions', 'previousExtractorVersion', 'previousToolVersions']) expect(s).not.toHaveProperty(k);
  });
});
