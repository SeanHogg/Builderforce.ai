-- 0002 · PRD 20 — apps-track twin of migrations/1337 + 1340: every project_id → BIGINT.
--
-- projects.id is BIGINT on the primary track and growth.ts declares project_sites,
-- site_collections and site_traffic_daily `project_id` bigint, but 0001 created them INTEGER
-- (bare ids into the core database — no FK on this track). Plain widen, idempotent: only
-- columns still int4 are altered and a missing table is skipped. int4 → int8 is additive, so
-- the old Worker keeps working. migrate.mjs runs this file as one transaction, so
-- `SET LOCAL lock_timeout` makes it fail fast rather than block live site traffic.
SET LOCAL lock_timeout = '5s';
-- The whole DO block is ONE statement, so no statement cap: the rewrites take as long
-- as they take. lock_timeout is what protects traffic.
SET LOCAL statement_timeout = 0;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT listed.tbl
    FROM (VALUES
      ('project_sites'),
      ('site_collections'),
      ('site_traffic_daily')
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
