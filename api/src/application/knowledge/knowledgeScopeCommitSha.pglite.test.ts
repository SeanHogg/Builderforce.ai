/**
 * Migration 1367 + the scope store against REAL Postgres (PGlite): the git commit a review ran at is written with the scope
 * that records its digest, read back on `scopes()` / `scope()`, and moves to `previous_commit_sha` with the digest — so
 * Compare's baseline (`previousDigest`) names the commit of THAT review and the editor can read its source there. A row from
 * before the migration, a review that stated none and a later pack of the same review all read as the rules say, never as a
 * default.
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
  for (const m of [
    '1279_knowledge_scope_previous_digest.sql', '1294_knowledge_scope_provenance.sql', '1343_knowledge_scope_measured_with.sql', '1367_knowledge_scope_commit_sha.sql',
  ]) await pg.exec(migration(m));
  store = drizzleKnowledgeStore(drizzle(pg) as unknown as Db, 1, 1);
});

afterAll(async () => { await pg.close(); });
beforeEach(async () => { await pg.exec('DELETE FROM knowledge_scopes'); });

const ROOT = 'ws:a';
const C1 = 'a'.repeat(40);
const C2 = 'b'.repeat(40);
const C3 = 'c'.repeat(40);
const review = (digest: string | undefined, commitSha?: string) =>
  store.upsertScope({ rootId: ROOT, title: 'A', packs: ['code'], ...(digest ? { lastDigest: digest } : {}), ...(commitSha ? { commitSha } : {}) });

describe('migration 1367', () => {
  it('re-runs cleanly (expand only, idempotent)', async () => {
    await expect(pg.exec(migration('1367_knowledge_scope_commit_sha.sql'))).resolves.toBeDefined();
  });

  it('adds two nullable varchar columns, no defaults, matching the Drizzle schema', async () => {
    const cols = (await pg.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_name = 'knowledge_scopes' AND column_name IN ('commit_sha', 'previous_commit_sha') ORDER BY column_name`)).rows;
    expect(cols).toEqual([
      { column_name: 'commit_sha', data_type: 'character varying', is_nullable: 'YES', column_default: null },
      { column_name: 'previous_commit_sha', data_type: 'character varying', is_nullable: 'YES', column_default: null },
    ]);
    const schema = getTableColumns(knowledgeScopes);
    expect([schema.commitSha.name, schema.previousCommitSha.name]).toEqual(['commit_sha', 'previous_commit_sha']);
    expect(schema.commitSha.notNull).toBe(false);
    expect(schema.previousCommitSha.notNull).toBe(false);
  });
});

describe('scope store: the commit a review ran at', () => {
  it('round-trips the commit written with a review digest, on scope() and scopes()', async () => {
    await review('d1', C1);
    expect(await store.scope(ROOT)).toMatchObject({ lastDigest: 'd1', commitSha: C1 });
    expect((await store.scopes())[0]).toMatchObject({ lastDigest: 'd1', commitSha: C1 });
  });

  it('a NEW digest moves the commit to previousCommitSha with previousDigest (Compare\'s baseline) and takes the new one', async () => {
    await review('d1', C1);
    await review('d2', C2);
    expect(await store.scope(ROOT)).toMatchObject({ lastDigest: 'd2', commitSha: C2, previousDigest: 'd1', previousCommitSha: C1 });
    await review('d3', C3);
    expect(await store.scope(ROOT)).toMatchObject({ lastDigest: 'd3', commitSha: C3, previousDigest: 'd2', previousCommitSha: C2 });
  });

  it('a review that states no commit is unknown: the field is absent, and the older commit still moves to previous', async () => {
    await review('d1', C1);
    await review('d2');
    const s = await store.scope(ROOT);
    expect(s).toMatchObject({ lastDigest: 'd2', previousDigest: 'd1', previousCommitSha: C1 });
    expect(s).not.toHaveProperty('commitSha');
  });

  it('the SAME digest again keeps the commit it first recorded (a later pack, sent after HEAD moved)', async () => {
    await review('d1', C1);
    await review('d1', C2);
    expect(await store.scope(ROOT)).toMatchObject({ lastDigest: 'd1', commitSha: C1 });
  });

  it('the same digest fills a commit the first pack did not state', async () => {
    await review('d1');
    await review('d1', C1);
    expect(await store.scope(ROOT)).toMatchObject({ lastDigest: 'd1', commitSha: C1 });
  });

  it('a scope write without a digest (an aborted review) keeps the last good commit and stores none of its own', async () => {
    await review('d1', C1);
    await review(undefined, C2);
    expect(await store.scope(ROOT)).toMatchObject({ lastDigest: 'd1', commitSha: C1 });
  });

  it('a row from before the migration reads as unknown (no fields), never a default', async () => {
    await pg.exec(`INSERT INTO knowledge_scopes (tenant_id, project_id, root_id, title, packs, last_digest, previous_digest)
      VALUES (1, 1, '${ROOT}', 'A', ARRAY['code'], 'd2', 'd1')`);
    const s = await store.scope(ROOT);
    expect(s).toMatchObject({ lastDigest: 'd2', previousDigest: 'd1' });
    for (const k of ['commitSha', 'previousCommitSha']) expect(s).not.toHaveProperty(k);
  });
});
