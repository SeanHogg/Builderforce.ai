-- 1337 · PRD 20 — consolidate projects.id (and every column that references it) onto BIGINT.
--
-- projects is the most-referenced table in the model (60+ inbound FKs plus a
-- set of bare project_id columns that keep the value without a Drizzle-level
-- FK to avoid a schema-module edge). The assignable int4 pool is the ceiling
-- none of them can outgrow. projects.id becomes BIGINT and its serial sequence
-- `AS bigint` (ALTER COLUMN TYPE does NOT widen an owned sequence — it would
-- stay capped at 2147483647). Application types are unchanged — drizzle
-- `bigint(mode:'number')` is still a TS number.
--
-- Corrected in place before it ever applied: the first version could not run on
-- any Postgres (`unnest` flattens a 2-D array, so `pair[1]` subscripted text) and
-- its FK snapshot resolved the PARENT column name on the CHILD side, matching no
-- FK. 1340 (+ operational 0031, apps 0002) are idempotent completers on top.
--
-- No FK is dropped: Postgres rebuilds and revalidates the constraints and indexes
-- that depend on a column whose type changes, on either side of the FK.
--
-- SELF-CORRECTING: rather than hand-listing every FK, it reads the catalog for
-- every foreign key whose referenced column is projects.id — including FKs
-- declared only in raw migration SQL (e.g. discovery.ts's customer_interviews /
-- research_notes) — and widens each child column (resolved per key pair through
-- unnest(conkey, confkey), so composite FKs are covered). Bare project_id columns
-- (no FK) are widened from an explicit list. Only int4 columns are touched, and a
-- table's columns are altered in ONE statement so it is rewritten once.
--
-- Each ALTER rewrites its table under ACCESS EXCLUSIVE. migrate.mjs runs this file
-- as one transaction, so `SET LOCAL lock_timeout` makes it fail fast instead of
-- queueing behind (and in front of) production traffic; a timeout rolls the whole
-- file back — re-run it.
SET LOCAL lock_timeout = '5s';
-- The whole DO block is ONE statement, so no statement cap: the rewrites take as long
-- as they take. lock_timeout is what protects traffic.
SET LOCAL statement_timeout = 0;

-- Postgres refuses to retype a column a trigger depends on (`UPDATE OF col`, or a
-- WHEN clause — e.g. trg_tasks_swimlane on tasks.project_id, mig 1115). This
-- session-local helper runs one ALTER TABLE with that table's user triggers dropped
-- and recreated verbatim around it (disabled ones stay disabled). Shared with 1340.
CREATE OR REPLACE FUNCTION pg_temp.bf_alter_keeping_triggers(tbl regclass, clauses text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  saved RECORD;
  defs  text[] := '{}';
  off   text[] := '{}';
BEGIN
  FOR saved IN
    SELECT tgname, pg_get_triggerdef(oid) AS def, tgenabled
    FROM pg_trigger WHERE tgrelid = tbl AND NOT tgisinternal
  LOOP
    defs := defs || saved.def;
    IF saved.tgenabled = 'D' THEN off := off || saved.tgname::text; END IF;
    EXECUTE format('DROP TRIGGER %I ON %s', saved.tgname, tbl);
  END LOOP;
  EXECUTE format('ALTER TABLE %s %s', tbl, clauses);
  FOR i IN 1 .. coalesce(array_length(defs, 1), 0) LOOP EXECUTE defs[i]; END LOOP;
  FOR i IN 1 .. coalesce(array_length(off, 1), 0) LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', tbl, off[i]);
  END LOOP;
END $fn$;

DO $$
DECLARE
  seq TEXT;
  r   RECORD;
BEGIN
  -- ── 1 · projects.id → BIGINT, and its sequence with it ─────────────────
  PERFORM pg_temp.bf_alter_keeping_triggers('public.projects'::regclass, 'ALTER COLUMN id TYPE BIGINT');
  seq := pg_get_serial_sequence('public.projects', 'id');
  IF seq IS NOT NULL THEN
    EXECUTE format('ALTER SEQUENCE %s AS BIGINT', seq);
  END IF;

  -- ── 2 · Every FK child column + every bare project_id column → BIGINT ──
  FOR r IN
    WITH targets AS (
      SELECT con.conrelid AS rel, child.attname AS col
      FROM pg_constraint con
      CROSS JOIN LATERAL unnest(con.conkey, con.confkey) AS k(child_attnum, parent_attnum)
      JOIN pg_attribute parent ON parent.attrelid = con.confrelid
                              AND parent.attnum   = k.parent_attnum
                              AND parent.attname  = 'id'
      JOIN pg_attribute child  ON child.attrelid  = con.conrelid
                              AND child.attnum    = k.child_attnum
      WHERE con.contype = 'f'
        AND con.confrelid = 'public.projects'::regclass
      UNION
      SELECT to_regclass('public.' || v.tbl), v.col
      FROM (VALUES
        ('activity_log',          'project_id'),
        ('agent_benchmark_cases', 'project_id'),
        ('feedback_collectors',   'project_id'),
        ('feedback_submissions',  'project_id'),
        ('job_postings',          'project_id'),
        ('llm_batch_jobs',        'project_id'),
        ('llm_usage_log',         'project_id'),
        ('research_notes',        'project_id'),
        ('run_model_outcomes',    'project_id'),
        ('tenant_skills',         'project_id')
      ) AS v(tbl, col)
      WHERE to_regclass('public.' || v.tbl) IS NOT NULL
    )
    SELECT t.rel::regclass::text AS tbl,
           string_agg(format('ALTER COLUMN %I TYPE BIGINT', t.col), ', ' ORDER BY t.col) AS clauses
    FROM (SELECT DISTINCT rel, col FROM targets) t
    JOIN pg_attribute a ON a.attrelid = t.rel
                       AND a.attname  = t.col
                       AND NOT a.attisdropped
    WHERE a.atttypid = 'int4'::regtype
    GROUP BY t.rel
    ORDER BY 1
  LOOP
    PERFORM pg_temp.bf_alter_keeping_triggers(r.tbl::regclass, r.clauses);
  END LOOP;

  -- ── 3 · Unblock migration 1336's deferred governance FKs ───────────────
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
