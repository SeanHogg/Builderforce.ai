-- 0078_rename_claw_to_agent_host.sql
--
-- Rebrand: "Claw" (a registered runtime host/machine owned by a tenant) -> "AgentHost".
-- Part of retiring the "CoderClaw" brand in favour of "BuilderForce Agents".
--
-- NOTE on the name: the host entity is AgentHost (table agent_hosts), NOT "Agent"
-- (Builderforce already has a distinct persona `Agent`/`agents`) and NOT "AgentRuntime"
-- (that name is already taken by the cloud/browser dispatch execution surface at
-- /api/agent-runtime). AgentHost == "a registered machine owned by a tenant".
--
-- All renames are metadata-only (no data rewrite). The whole thing runs inside one
-- DO block so it is ATOMIC — if any step fails the entire migration rolls back.
-- It is also IDEMPOTENT: every step is guarded by an existence check, so re-running
-- after a partial/previous apply is safe.
--
-- Object map:
--   table  coderclaw_instances            -> agent_hosts           (special case)
--   tables claw_* / managed_claw_requests -> replace 'claw' with 'agent_host'
--   cols   *claw*  (claw_id, assigned_claw_id, default_claw_id,
--                   claw_name, claw_session_id, ...)  -> replace 'claw'->'agent_host'
--   enums  claw_status, claw_directory_status,
--          managed_claw_request_status   -> replace 'claw'->'agent_host'
--   enum value assignment_scope 'claw'   -> 'host'
--   enum value auth_token_type  'claw'   -> 'host'
--   indexes *claw*                       -> replace 'claw'->'agent_host'
--
-- The renames below are performed dynamically (a DO-block looping over
-- information_schema), so they have no literal old->new pairs for the static
-- schema-drift checker to read. These directives declare the same transformation
-- so check-schema-drift.mjs can reconstruct the post-rename schema and verify it
-- matches schema.ts — WITHOUT grandfathering. Keep them in sync with the DO-block.
-- @schema-drift-rename-table coderclaw_instances -> agent_hosts
-- @schema-drift-rename-replace claw -> agent_host

DO $$
DECLARE
  r record;
BEGIN
  -- 1. Special-case the primary host table (substring replace would mangle it).
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'coderclaw_instances') THEN
    EXECUTE 'ALTER TABLE coderclaw_instances RENAME TO agent_hosts';
  END IF;

  -- 2. Remaining tables whose name contains 'claw' (claw_projects, claw_directories,
  --    claw_directory_files, claw_sync_history, managed_claw_requests, ...).
  FOR r IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE '%claw%'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME TO %I',
                   r.table_name, replace(r.table_name, 'claw', 'agent_host'));
  END LOOP;

  -- 3. Every column whose name contains 'claw', on any table.
  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name LIKE '%claw%'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I',
                   r.table_name, r.column_name,
                   replace(r.column_name, 'claw', 'agent_host'));
  END LOOP;

  -- 4. Enum TYPES whose name contains 'claw'.
  FOR r IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype = 'e'
      AND t.typname LIKE '%claw%'
  LOOP
    EXECUTE format('ALTER TYPE %I RENAME TO %I',
                   r.typname, replace(r.typname, 'claw', 'agent_host'));
  END LOOP;

  -- 5. Enum VALUES 'claw' -> 'host' on shared enums (the scope/token-type is the
  --    runtime host, distinct from the persona 'agent' value which stays as-is).
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'assignment_scope' AND e.enumlabel = 'claw') THEN
    EXECUTE $q$ALTER TYPE assignment_scope RENAME VALUE 'claw' TO 'host'$q$;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'auth_token_type' AND e.enumlabel = 'claw') THEN
    EXECUTE $q$ALTER TYPE auth_token_type RENAME VALUE 'claw' TO 'host'$q$;
  END IF;

  -- 6. Indexes whose name contains 'claw' (cosmetic, keeps names in sync with cols).
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'i'
      AND c.relname LIKE '%claw%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I',
                   r.relname, replace(r.relname, 'claw', 'agent_host'));
  END LOOP;
END $$;
