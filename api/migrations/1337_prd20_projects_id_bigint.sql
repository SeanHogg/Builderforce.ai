-- 1337 · PRD 20 — consolidate projects.id (and every column that references it) onto BIGINT.
--
-- projects is the most-referenced table in the model (60+ inbound FKs plus a
-- set of bare project_id columns that keep the value without a Drizzle-level
-- FK to avoid a schema-module edge). The assignable int4 pool is the ceiling
-- none of them can outgrow. projects.id becomes BIGSERIAL (application types
-- are unchanged — drizzle `bigint(mode:'number')` is still a TS number).
--
-- THIS WHOLE MIGRATION IS ONE DO BLOCK so it runs in a single transaction —
-- Postgres refuses to ALTER the TYPE of projects.id while any FK references it,
-- so the drop, the widen, and the re-add must be atomic or the migration cannot
-- apply at all.
--
-- It is SELF-CORRECTING: rather than hand-listing every FK, it reads the catalog
-- for every foreign key that points at projects(id) — including FKs declared
-- only in raw migration SQL (e.g. discovery.ts's customer_interviews /
-- research_notes keep their FK out of the Drizzle schema to avoid a
-- discovery->delivery module edge) — drops each, widens the child column, then
-- re-creates the FK with its original name and ON DELETE action. Widening the
-- CHILD before the PARENT keeps the relationship always typeable: an int8 child
-- can reference an int4 parent (the value always fits), never the reverse.
--
-- Bare project_id columns (no FK) are widened explicitly — grep the schema for
-- `integer('project_id')` / `integer('*_project_id')` to see them.

DO $$
DECLARE
  fk RECORD;
  tables_with_fk TEXT[];
  bare RECORD;
BEGIN
  -- Snapshot every FK that points at projects(id), in dependency-safe order.
  CREATE TEMP TABLE prd20_fks ON COMMIT DROP AS
  SELECT con.conname AS name,
         con.conrelid::regclass::text AS tbl,
         att.attname AS col,
         CASE con.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
              WHEN 'd' THEN 'SET DEFAULT' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END AS del
  FROM pg_constraint con
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f'
    AND con.confrelid = 'public.projects'::regclass
    AND att.attname = 'id';

  -- ── 1 · Drop every FK that points at projects(id) ──────────────────────
  FOR fk IN SELECT * FROM prd20_fks LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tbl, fk.name);
  END LOOP;

  -- ── 2 · projects.id → BIGINT (sequence backing the serial follows) ─────
  ALTER TABLE projects ALTER COLUMN id TYPE BIGINT;

  -- ── 3a · Every FK-bearing referencing column → BIGINT ─────────────────
  SELECT ARRAY(SELECT DISTINCT tbl FROM prd20_fks) INTO tables_with_fk;
  FOR fk IN SELECT DISTINCT tbl, col FROM prd20_fks LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I TYPE BIGINT', fk.tbl, fk.col);
  END LOOP;

  -- ── 3b · Bare project_id columns (no FK — declared without .references()
  --        in the Drizzle schema; where an FK exists it lives in raw migration
  --        SQL only) ─────────────────────────────────────────────────────
  FOR bare IN
    SELECT unnest(ARRAY[
      ['activity_log',                 'project_id'],
      ['agent_benchmark_cases',        'project_id'],
      ['feedback_collectors',          'project_id'],
      ['feedback_submissions',         'project_id'],
      ['job_postings',                 'project_id'],
      ['llm_batch_jobs',               'project_id'],
      ['llm_usage_log',                'project_id'],
      ['research_notes',               'project_id'],
      ['run_model_outcomes',           'project_id'],
      ['tenant_skills',                'project_id']
    ]) AS pair
  LOOP
    -- Skip any bare column that already went through 3a (was FK-bearing).
    IF NOT (bare.pair[1] = ANY(tables_with_fk)) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE BIGINT',
                     bare.pair[1], bare.pair[2]);
    END IF;
  END LOOP;

  -- ── 4 · Re-create each FK with its original name + ON DELETE action ────
  FOR fk IN SELECT * FROM prd20_fks LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES projects(id) ON DELETE %s',
                   fk.tbl, fk.name, fk.col, fk.del);
  END LOOP;

  -- ── 5 · Unblock migration 1336's deferred governance FKs ───────────────
  -- governance_policy_packs.project_id and governance_audit_runs.project_id are
  -- already BIGINT (1336) with the FK intentionally omitted until projects.id
  -- was BIGINT. It is now — add them.
  ALTER TABLE governance_policy_packs
    ADD CONSTRAINT governance_policy_packs_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  ALTER TABLE governance_audit_runs
    ADD CONSTRAINT governance_audit_runs_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
END $$;
