/**
 * Migrations 1337 + 1340 (primary) and 0031 (operational) against REAL Postgres (PGlite), executed
 * from their files: after them every column that references projects(id) is BIGINT, the FKs survive
 * the widen, projects.id's serial sequence is bigint, and re-running the corrective is a no-op.
 * The Drizzle schema declares the same bigint columns.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { getTableColumns } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { llmUsageLog } from '../database/schema/agents';
import { ideProjects, projects, tasks } from '../database/schema/delivery';
import { activityLog } from '../database/schema/kernel';

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url).href), 'utf8');
const M1337 = read('../../../migrations/1337_prd20_projects_id_bigint.sql');
const M1340 = read('../../../migrations/1340_prd20_project_fk_columns_bigint.sql');
const OPS_0031 = read('../../../transactional-migrations/0031_project_id_bigint.sql');

/**
 * The shape 1337 met in production, trimmed to what it and 1340 touch: a serial projects.id with
 * FK-bearing int4 children (one named `project_id`, two oddly named on one table, one composite),
 * bare int4 project ids, and the 1336 governance tables 1337 adds its deferred FKs to.
 */
const PRIMARY_BASE = `
CREATE TABLE projects (id serial PRIMARY KEY, tenant_id integer NOT NULL, name text);
CREATE UNIQUE INDEX projects_tenant_id_id ON projects (tenant_id, id);
CREATE TABLE tasks (id serial PRIMARY KEY, status text, lane text, project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE);
CREATE INDEX idx_tasks_project ON tasks (project_id);
-- 1115's trg_tasks_swimlane fires on UPDATE OF project_id, which blocks a plain ALTER COLUMN TYPE.
CREATE FUNCTION set_tasks_lane() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.lane := 'lane-' || NEW.project_id; RETURN NEW; END $$;
CREATE TRIGGER trg_tasks_swimlane BEFORE INSERT OR UPDATE OF status, project_id ON tasks FOR EACH ROW EXECUTE FUNCTION set_tasks_lane();
CREATE TRIGGER trg_tasks_off BEFORE UPDATE OF project_id ON tasks FOR EACH ROW EXECUTE FUNCTION set_tasks_lane();
ALTER TABLE tasks DISABLE TRIGGER trg_tasks_off;
CREATE TABLE ide_projects (
  id serial PRIMARY KEY,
  container_project_id integer REFERENCES projects(id) ON DELETE SET NULL,
  storage_project_id integer REFERENCES projects(id) ON DELETE SET NULL
);
CREATE TABLE boards (
  id serial PRIMARY KEY, tenant_id integer NOT NULL, project_id integer,
  CONSTRAINT boards_project_fk FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id) ON DELETE CASCADE
);
CREATE TABLE llm_usage_log (id serial PRIMARY KEY, project_id integer);
CREATE TABLE activity_signals (id serial PRIMARY KEY, project_id integer);
CREATE TABLE governance_policy_packs (id serial PRIMARY KEY, project_id bigint);
CREATE TABLE governance_audit_runs (id serial PRIMARY KEY, project_id bigint);
CREATE TABLE activity_log (id bigserial PRIMARY KEY, project_id integer);
CREATE TABLE agent_benchmark_cases (id serial PRIMARY KEY, project_id integer);
CREATE TABLE feedback_collectors (id serial PRIMARY KEY, project_id integer);
CREATE TABLE feedback_submissions (id serial PRIMARY KEY, project_id integer);
CREATE TABLE job_postings (id serial PRIMARY KEY, project_id integer);
CREATE TABLE llm_batch_jobs (id serial PRIMARY KEY, project_id integer);
CREATE TABLE research_notes (id serial PRIMARY KEY, project_id integer);
CREATE TABLE run_model_outcomes (id serial PRIMARY KEY, project_id integer);
CREATE TABLE tenant_skills (id serial PRIMARY KEY, project_id integer);
INSERT INTO projects (tenant_id, name) VALUES (7, 'p');
INSERT INTO tasks (project_id) VALUES (1);
INSERT INTO boards (tenant_id, project_id) VALUES (7, 1);
`;

const OPS_BASE = `
CREATE TABLE llm_usage_log (id serial PRIMARY KEY, project_id integer);
CREATE TABLE ingestion_usage_log (id serial PRIMARY KEY, project_id integer);
CREATE TABLE activity_log (id bigserial PRIMARY KEY, project_id integer);
CREATE TABLE run_model_outcomes (id serial PRIMARY KEY, project_id integer);
CREATE TABLE llm_batch_jobs (id serial PRIMARY KEY, project_id integer);
`;

let primary: PGlite;
let ops: PGlite;

async function columnType(pg: PGlite, table: string, column: string): Promise<string | undefined> {
  const result = await pg.query<{ data_type: string }>(
    'SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2',
    [table, column],
  );
  return result.rows[0]?.data_type;
}

async function foreignKeys(pg: PGlite): Promise<string[]> {
  const result = await pg.query<{ fk: string }>(
    `SELECT conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) AS fk
       FROM pg_constraint WHERE contype = 'f' AND confrelid = 'projects'::regclass ORDER BY 1`,
  );
  return result.rows.map((r) => r.fk);
}

beforeAll(async () => {
  primary = new PGlite();
  await primary.exec(PRIMARY_BASE);
  await primary.exec(M1337);
  await primary.exec(M1340);
  ops = new PGlite();
  await ops.exec(OPS_BASE);
  await ops.exec(OPS_0031);
});

afterAll(async () => {
  await primary.close();
  await ops.close();
});

describe('1337 + 1340 projects(id) references → bigint', () => {
  it('regression: 1337 missed child FK columns', async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(PRIMARY_BASE);
      await fresh.exec(M1337);
      // 1337 alone now widens the FK-bearing children (it first matched none of them).
      for (const [table, column] of [['tasks', 'project_id'], ['ide_projects', 'storage_project_id'], ['boards', 'project_id']] as const) {
        expect(await columnType(fresh, table, column), `${table}.${column}`).toBe('bigint');
      }
      // 1340 still completes a DB left in the first 1337's shape: parent bigint, children int4.
      await fresh.exec("SELECT pg_temp.bf_alter_keeping_triggers('tasks', 'ALTER COLUMN project_id TYPE integer')");
      await fresh.exec(M1340);
      expect(await columnType(fresh, 'tasks', 'project_id')).toBe('bigint');
    } finally {
      await fresh.close();
    }
  });

  it('widens every FK child column, composite and oddly named ones included, plus the bare ids', async () => {
    for (const [table, column] of [
      ['projects', 'id'],
      ['tasks', 'project_id'],
      ['ide_projects', 'container_project_id'],
      ['ide_projects', 'storage_project_id'],
      ['boards', 'project_id'],
      ['llm_usage_log', 'project_id'],
      ['activity_log', 'project_id'],
      ['activity_signals', 'project_id'],
      ['governance_policy_packs', 'project_id'],
    ] as const) {
      expect(await columnType(primary, table, column), `${table}.${column}`).toBe('bigint');
    }
    expect(await columnType(primary, 'boards', 'tenant_id')).toBe('integer');
  });

  it('keeps every FK (name and ON DELETE action) and the data intact', async () => {
    const fks = await foreignKeys(primary);
    expect(fks).toEqual(expect.arrayContaining([
      'tasks:tasks_project_id_fkey:FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
      'ide_projects:ide_projects_container_project_id_fkey:FOREIGN KEY (container_project_id) REFERENCES projects(id) ON DELETE SET NULL',
      'boards:boards_project_fk:FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE',
      'governance_policy_packs:governance_policy_packs_project_id_fkey:FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
    ]));
    const rows = await primary.query<{ n: number }>('SELECT count(*)::int AS n FROM tasks WHERE project_id = 1');
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('makes projects.id\'s sequence bigint, so ids past 2^31-1 insert and are referenced', async () => {
    const seq = await primary.query<{ data_type: string }>(
      "SELECT data_type FROM information_schema.sequences WHERE sequence_name = 'projects_id_seq'",
    );
    expect(seq.rows[0]?.data_type).toBe('bigint');
    await primary.query("SELECT setval('projects_id_seq', 3000000000)");
    const inserted = await primary.query<{ id: string }>("INSERT INTO projects (tenant_id, name) VALUES (7, 'big') RETURNING id::text");
    const id = inserted.rows[0]?.id;
    expect(id).toBe('3000000001');
    await primary.query('INSERT INTO tasks (project_id) VALUES ($1)', [id]);
  });

  it('regression: retypes a column a trigger depends on, keeping the trigger (and its disabled state)', async () => {
    const triggers = await primary.query<{ tgname: string; tgenabled: string }>(
      "SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'tasks'::regclass AND NOT tgisinternal ORDER BY tgname",
    );
    expect(triggers.rows).toEqual([{ tgname: 'trg_tasks_off', tgenabled: 'D' }, { tgname: 'trg_tasks_swimlane', tgenabled: 'O' }]);
    const row = await primary.query<{ lane: string }>("INSERT INTO tasks (project_id) VALUES (1) RETURNING lane");
    expect(row.rows[0]?.lane).toBe('lane-1');
  });

  it('re-applies as a no-op', async () => {
    const before = await foreignKeys(primary);
    await primary.exec(M1340);
    expect(await foreignKeys(primary)).toEqual(before);
    expect(await columnType(primary, 'tasks', 'project_id')).toBe('bigint');
  });
});

describe('0031 operational-track project_id → bigint', () => {
  it('widens every operational project_id and re-applies as a no-op', async () => {
    for (const table of ['llm_usage_log', 'ingestion_usage_log', 'activity_log', 'run_model_outcomes', 'llm_batch_jobs']) {
      expect(await columnType(ops, table, 'project_id'), table).toBe('bigint');
    }
    await ops.exec(OPS_0031);
    expect(await columnType(ops, 'llm_usage_log', 'project_id')).toBe('bigint');
  });
});

describe('Drizzle declares the same bigint columns', () => {
  it('projects.id and its references are bigint in the schema', () => {
    expect(getTableColumns(projects).id.columnType).toMatch(/^PgBig(Int53|Serial53)$/);
    expect(getTableColumns(tasks).projectId.columnType).toBe('PgBigInt53');
    expect(getTableColumns(ideProjects).containerProjectId.columnType).toBe('PgBigInt53');
    expect(getTableColumns(ideProjects).storageProjectId.columnType).toBe('PgBigInt53');
    expect(getTableColumns(llmUsageLog).projectId.columnType).toBe('PgBigInt53');
    expect(getTableColumns(activityLog).projectId.columnType).toBe('PgBigInt53');
  });
});
