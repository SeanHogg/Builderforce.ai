-- Rollback for migrations/0078_rename_claw_to_agent_host.sql
--
-- This file lives OUTSIDE migrations/ on purpose: the migrate runner auto-applies
-- everything in migrations/, and this is a manual rollback. To use it:
--   psql "$NEON_DATABASE_URL" -f scripts/rollback-0078-claw-rename.sql
--   DELETE FROM _migrations WHERE name = '0078_rename_claw_to_agent_host.sql';
--
-- It reverses the AgentHost rename back to Claw. The '%agent_host%' substring is
-- unique to objects created by 0078 (no pre-existing object uses it — verified), so
-- the reverse replace is safe. Atomic + idempotent, same as the forward migration.

DO $$
DECLARE
  r record;
BEGIN
  -- 1. Reverse the special-cased host table first (so it won't match the loop below).
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'agent_hosts') THEN
    EXECUTE 'ALTER TABLE agent_hosts RENAME TO coderclaw_instances';
  END IF;

  -- 2. Remaining agent_host_* tables -> claw_* / managed_claw_requests.
  FOR r IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE '%agent\_host%'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME TO %I',
                   r.table_name, replace(r.table_name, 'agent_host', 'claw'));
  END LOOP;

  -- 3. Columns.
  FOR r IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name LIKE '%agent\_host%'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I',
                   r.table_name, r.column_name,
                   replace(r.column_name, 'agent_host', 'claw'));
  END LOOP;

  -- 4. Enum types.
  FOR r IN
    SELECT t.typname FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e' AND t.typname LIKE '%agent\_host%'
  LOOP
    EXECUTE format('ALTER TYPE %I RENAME TO %I',
                   r.typname, replace(r.typname, 'agent_host', 'claw'));
  END LOOP;

  -- 5. Enum values 'host' -> 'claw'.
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'assignment_scope' AND e.enumlabel = 'host') THEN
    EXECUTE $q$ALTER TYPE assignment_scope RENAME VALUE 'host' TO 'claw'$q$;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'auth_token_type' AND e.enumlabel = 'host') THEN
    EXECUTE $q$ALTER TYPE auth_token_type RENAME VALUE 'host' TO 'claw'$q$;
  END IF;

  -- 6. Indexes.
  FOR r IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname LIKE '%agent\_host%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I',
                   r.relname, replace(r.relname, 'agent_host', 'claw'));
  END LOOP;
END $$;
