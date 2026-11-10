-- 1340 · PRD 20 — finish what 1337 meant to do: every column that references projects(id) → BIGINT.
--
-- Idempotent completer for 1337. 1337 was corrected in place (its first version could
-- not apply on any Postgres); after the corrected 1337 this is a no-op on a fresh DB, but
-- it stays correct on any DB — e.g. one where columns were created int4 by a path 1337
-- did not see. The first 1337 failed outright (its bare-column loop subscripted the text
-- that `unnest` of a 2-D array yields), so it never applied anywhere. Had that loop run,
-- two further defects would still have left the job undone, and this guards against both:
--
--   1. Its FK snapshot joined pg_attribute on the CHILD (conrelid / conkey[1]) and then
--      filtered `attname = 'id'`. Child columns are named `project_id`, `target_project_id`,
--      … so the snapshot would have matched essentially no FK, leaving ~60 FK-bearing child
--      columns INTEGER while the Drizzle schema declares bigint.
--   2. projects.id is a serial; ALTER COLUMN … TYPE does NOT change the owned sequence,
--      which would have stayed `AS integer` (max 2147483647) — the int4 ceiling 1337 set
--      out to lift.
--
-- What this does, idempotently (re-running is a no-op; safe on a fresh DB and on one
-- where 1337 already widened everything):
--
--   a. Widens projects.id's owned sequence to bigint.
--   b. Widens to BIGINT every column that is STILL int4 and is either
--        - the child side of any FK whose referenced column is projects.id (resolved
--          per key pair via unnest(conkey, confkey) — composite FKs included), or
--        - on the explicit list below: the columns the Drizzle schema declares as
--          project references without a guaranteed FK in SQL (bare scalar ids, FKs
--          that live only in raw SQL, tables renamed by dynamic SQL, and the
--          oddly-named *_project_id references).
--      All of a table's columns are altered in ONE statement so it is rewritten once.
--      The FK does not need dropping: ALTER COLUMN TYPE rebuilds and revalidates the
--      dependent constraint and indexes itself (int8 child → int8 parent).
--
-- Each ALTER rewrites its table under ACCESS EXCLUSIVE. migrate.mjs runs this file as one
-- transaction, so `SET LOCAL lock_timeout` makes it fail fast instead of queueing behind
-- (and in front of) production traffic; a timeout rolls the whole file back — re-run it.
-- The old Worker keeps working against the result: int4 → int8 widening is additive.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

DO $$
DECLARE
  seq TEXT := pg_get_serial_sequence('public.projects', 'id');
  r   RECORD;
BEGIN
  -- ── a · projects.id's sequence → bigint ────────────────────────────────
  IF seq IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_sequence WHERE seqrelid = seq::regclass AND seqtypid <> 'int8'::regtype
  ) THEN
    EXECUTE format('ALTER SEQUENCE %s AS BIGINT', seq);
  END IF;

  -- ── b · every int4 column that references projects(id) → BIGINT ────────
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
      SELECT to_regclass('public.' || listed.tbl), listed.col
      FROM (VALUES
        -- bare scalar project ids (no FK by design)
        ('activity_log',             'project_id'),
        ('activity_signals',         'project_id'),
        ('agent_benchmark_cases',    'project_id'),
        ('feedback_collectors',      'project_id'),
        ('feedback_submissions',     'project_id'),
        ('freelancer_conversations', 'project_id'),
        ('job_postings',             'project_id'),
        ('llm_batch_jobs',           'project_id'),
        ('llm_usage_log',            'project_id'),
        ('replay_sites',             'project_id'),
        ('run_model_outcomes',       'project_id'),
        ('tenant_skills',            'project_id'),
        -- FK lives only in raw migration SQL (discovery.ts keeps it out of Drizzle)
        ('customer_interviews',      'project_id'),
        ('research_notes',           'project_id'),
        -- FK created on a table later renamed by dynamic SQL (0078), or baseline-only
        ('agent_host_directories',   'project_id'),
        ('agent_host_projects',      'project_id'),
        ('tasks',                    'project_id'),
        -- project references not named `project_id`
        ('error_collectors',         'default_project_id'),
        ('ide_projects',             'container_project_id'),
        ('ide_projects',             'storage_project_id'),
        ('import_staged_projects',   'target_project_id'),
        ('innovation_ideas',         'linked_project_id'),
        ('rfp_requests',             'based_on_project_id')
      ) AS listed(tbl, col)
      WHERE to_regclass('public.' || listed.tbl) IS NOT NULL
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
    EXECUTE format('ALTER TABLE %s %s', r.tbl, r.clauses);
  END LOOP;
END $$;
