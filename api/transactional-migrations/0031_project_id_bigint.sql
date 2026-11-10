-- 0031 · PRD 20 — operational-track twin of migrations/1337 + 1340: every project_id → BIGINT.
--
-- projects.id is BIGINT on the primary track and the Drizzle schema declares every project_id
-- bigint, but the operational tables created by 0001 (llm_usage_log, ingestion_usage_log,
-- activity_log), 0013 (run_model_outcomes) and 0020 (llm_batch_jobs) still hold it as INTEGER —
-- an id past 2^31-1 would fail every usage/activity insert. These are unenforced scalar ids
-- (no FKs on this track), so it is a plain widen. Idempotent: only columns still int4 are
-- altered, and a missing table is skipped. int4 → int8 is additive, so the old Worker keeps
-- working. Each ALTER rewrites its table under ACCESS EXCLUSIVE; migrate.mjs runs this file as
-- one transaction, so `SET LOCAL lock_timeout` makes it fail fast rather than block live writes
-- (a timeout rolls the file back — re-run it).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT listed.tbl
    FROM (VALUES
      ('activity_log'),
      ('ingestion_usage_log'),
      ('llm_batch_jobs'),
      ('llm_usage_log'),
      ('run_model_outcomes')
    ) AS listed(tbl)
    JOIN pg_attribute a ON a.attrelid = to_regclass('public.' || listed.tbl)
                       AND a.attname  = 'project_id'
                       AND NOT a.attisdropped
    WHERE a.atttypid = 'int4'::regtype
    ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN project_id TYPE BIGINT', r.tbl);
  END LOOP;
END $$;
