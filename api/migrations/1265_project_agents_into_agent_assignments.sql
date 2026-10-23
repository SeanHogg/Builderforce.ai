-- 1265 — Fold `project_agents` into the canonical `agent_assignments` (0082).
--        EXPAND half. The CONTRACT half (drop the table, re-add the schedule FK) is
--        1269_drop_project_agents.sql, shipped once the new Worker is live.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- Operator decision: `agent_assignments` is canonical. 0082 introduced it as "the single
-- source the surfaces read, superseding the fragmented project_agents / swimlane target /
-- assignedAgentHost notions"; 1085 moved the swimlane half. The project half stayed in
-- `project_agents`, so "which agents are on this project?" had two answers — the project
-- capabilities tab read `project_agents`, `agent_assignments` carried `scope = 'project'`.
--
-- ── WHAT `project_agents` HELD, AND WHERE EACH PART LANDS ───────────────────
-- Two different things under one primary key:
--   * project ATTACHMENTS (`project_id NOT NULL`)  → scope = 'project',
--     scope_id = project id, and the new `project_id` column (a real FK, so deleting a
--     project still cascades its staffing exactly as `project_agents` did).
--   * the agent's workspace IDENTITY (`project_id IS NULL`) — the tenant-wide handle a
--     bridged / hired workforce agent is configured through → scope = 'workspace',
--     scope_id NULL. A new scope value, NOT 'global': 'global' is an ASSIGNMENT
--     ("run this agent tenant-wide"); an identity row only says the workspace holds the
--     agent and gives its per-agent configuration somewhere to hang.
--   * `governance` and `added_by` are carried as columns (null for every other scope).
--   * `project_agents` had no active flag; a row's existence was the whole fact.
--
-- ── THE INTEGER HANDLE ──────────────────────────────────────────────────────
-- `artifact_assignments.scope_id` (scope = 'agent') and `cron_jobs.project_agent_id`
-- both key on `project_agents.id`, an INTEGER. `agent_assignments.id` is a uuid, and
-- `artifact_assignments.scope_id` is an integer shared by every scope (task, project,
-- host…), so re-keying it is not on the table. Instead every assignment gets an integer
-- `agent_handle`, and each folded row KEEPS ITS OLD ID as its handle — the same move 1085
-- made with the lane ids — so every per-agent skill/persona assignment and every
-- per-agent schedule keeps pointing at the same agent with no rewrite. The sequence
-- starts above the highest `project_agents.id`, so handles minted for the rows already in
-- `agent_assignments` can never collide with a carried-over one.
--
-- ── DEDUPE ──────────────────────────────────────────────────────────────────
-- An equivalent assignment may already exist (same tenant, agent, scope and target —
-- e.g. a `scope = 'project'` row written through the MCP tools). That row is KEPT and
-- adopts the `project_agents` id as its handle (so the capability/cron links follow it),
-- filling name / governance / added_by / project_id where it had none and taking the
-- project_agents role only when its own is still 'default'.

-- ── EXPAND / CONTRACT: WHY THE TABLE SURVIVES THIS MIGRATION ─────────────────
-- Migrations run BEFORE the Worker deploys, so for a window the OLD Worker still reads
-- and writes `project_agents` while the NEW one reads `agent_assignments`. This file only
-- EXPANDS; nothing the old Worker touches is removed:
--   * `project_agents` stays, untouched in shape. Its `id` default is switched to the
--     shared handle sequence, so a row the old Worker inserts during the window gets an id
--     no handle the new Worker mints can ever collide with — 1269 then folds it in under
--     its own id, and any capability/schedule the old Worker hung off it follows.
--   * `cron_jobs.project_agent_id` loses its FK to `project_agents` here. It has to: the
--     new Worker writes HANDLES into it, and a handle minted after this fold has no
--     `project_agents` row. Old-Worker writes still succeed (any value is accepted, and an
--     old id IS a handle). 1269 re-adds the FK, targeting `agent_assignments(agent_handle)`.
--   * `project_agents_fold_ledger` records which ids THIS fold carried, so 1269 can tell a
--     row the old Worker added in the window (fold it), one it deleted (drop the
--     assignment), and one the NEW Worker removed (leave it gone — never resurrect it).
--
-- Fails LOUDLY: if any project_agents row is neither adopted nor folded, or a schedule
-- names an agent the fold did not carry, the migration raises and nothing is committed.

ALTER TABLE agent_assignments
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS governance TEXT,
  ADD COLUMN IF NOT EXISTS added_by   VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL;

CREATE SEQUENCE IF NOT EXISTS agent_assignments_agent_handle_seq;

CREATE TABLE IF NOT EXISTS project_agents_fold_ledger (
  handle    INTEGER   PRIMARY KEY,
  folded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  has_table    BOOLEAN := EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'project_agents' AND table_type = 'BASE TABLE');
  pa_seq       TEXT;
  seq_last     BIGINT := 0;
  handle_floor BIGINT := 0;
  dangling     INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'agent_assignments' AND column_name = 'agent_handle'
  ) THEN
    RETURN;  -- already expanded
  END IF;

  IF has_table THEN
    -- A per-agent capability whose scope_id names no project_agents row points at
    -- nothing today; carried over, it would silently attach to whichever agent later
    -- drew that handle. Remove it before the floor is computed.
    DELETE FROM artifact_assignments aa
     WHERE aa.scope = 'agent'
       AND NOT EXISTS (SELECT 1 FROM project_agents pa WHERE pa.id = aa.scope_id);
    GET DIAGNOSTICS dangling = ROW_COUNT;
    RAISE NOTICE 'agent_assignments: removed % dangling agent-scoped capability assignment(s).', dangling;

    pa_seq := pg_get_serial_sequence('project_agents', 'id');
    IF pa_seq IS NOT NULL THEN
      EXECUTE format('SELECT last_value FROM %s', pa_seq) INTO seq_last;
    END IF;
    SELECT GREATEST(
      COALESCE((SELECT MAX(id) FROM project_agents), 0),
      COALESCE(seq_last, 0),
      COALESCE((SELECT MAX(scope_id) FROM artifact_assignments WHERE scope = 'agent'), 0)
    ) INTO handle_floor;
  END IF;

  -- `false` = the NEXT nextval returns exactly floor + 1.
  PERFORM setval('agent_assignments_agent_handle_seq', handle_floor + 1, false);
  -- A volatile default on ADD COLUMN rewrites the table, so every existing row draws
  -- its own handle from the sequence — all of them above every project_agents id.
  ALTER TABLE agent_assignments
    ADD COLUMN agent_handle INTEGER NOT NULL DEFAULT nextval('agent_assignments_agent_handle_seq');
  ALTER SEQUENCE agent_assignments_agent_handle_seq OWNED BY agent_assignments.agent_handle;

  IF has_table THEN
    -- Old-Worker inserts during the deploy window draw from the SAME sequence.
    ALTER TABLE project_agents
      ALTER COLUMN id SET DEFAULT nextval('agent_assignments_agent_handle_seq');
  END IF;
END $$;

-- Rows already scoped to a project carry the id only as text in scope_id; give them the
-- real FK column too, where the id names a project of the same tenant.
UPDATE agent_assignments aa
   SET project_id = p.id
  FROM projects p
 WHERE aa.scope = 'project'
   AND aa.project_id IS NULL
   AND aa.scope_id ~ '^[0-9]{1,9}$'
   AND p.id = aa.scope_id::integer
   AND p.tenant_id = aa.tenant_id;

DO $$
DECLARE
  dep      RECORD;
  total    INTEGER;
  adopted  INTEGER;
  inserted INTEGER;
  orphaned INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'project_agents' AND table_type = 'BASE TABLE'
  ) OR EXISTS (SELECT 1 FROM project_agents_fold_ledger) THEN
    RETURN;  -- nothing to fold, or already folded
  END IF;

  SELECT count(*) INTO total FROM project_agents;

  -- 1. DEDUPE — an equivalent assignment adopts the project_agents id as its handle.
  UPDATE agent_assignments aa
     SET agent_handle = pa.id,
         project_id   = COALESCE(aa.project_id, pa.project_id),
         name         = COALESCE(aa.name, pa.name),
         governance   = COALESCE(aa.governance, pa.governance),
         added_by     = COALESCE(aa.added_by, pa.added_by),
         role         = CASE WHEN aa.role = 'default' THEN pa.role ELSE aa.role END,
         created_at   = LEAST(aa.created_at, pa.created_at),
         updated_at   = GREATEST(aa.updated_at, pa.updated_at)
    FROM project_agents pa
   WHERE aa.tenant_id  = pa.tenant_id
     AND aa.agent_kind = pa.agent_kind
     AND aa.agent_ref  = pa.agent_ref
     AND (
           (pa.project_id IS NOT NULL AND aa.scope = 'project'   AND aa.scope_id = pa.project_id::text)
        OR (pa.project_id IS NULL     AND aa.scope = 'workspace' AND aa.scope_id IS NULL)
         );
  GET DIAGNOSTICS adopted = ROW_COUNT;

  -- 2. FOLD the rest, handle = old id.
  INSERT INTO agent_assignments (
    tenant_id, agent_kind, agent_ref, scope, scope_id, project_id, execution_scope,
    role, name, governance, added_by, agent_handle, created_at, updated_at
  )
  SELECT
    pa.tenant_id,
    pa.agent_kind,
    pa.agent_ref,
    CASE WHEN pa.project_id IS NULL THEN 'workspace' ELSE 'project' END,
    pa.project_id::text,
    pa.project_id,
    CASE WHEN pa.project_id IS NULL THEN 'global' ELSE 'project' END,
    pa.role,
    pa.name,
    pa.governance,
    pa.added_by,
    pa.id,
    pa.created_at,
    pa.updated_at
  FROM project_agents pa
  WHERE NOT EXISTS (SELECT 1 FROM agent_assignments aa WHERE aa.agent_handle = pa.id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  IF adopted + inserted <> total THEN
    RAISE EXCEPTION 'agent_assignments: fold incomplete — % project_agents row(s), % adopted + % folded. Refusing to continue.',
      total, adopted, inserted;
  END IF;
  RAISE NOTICE 'agent_assignments: % project_agents row(s) adopted by an existing assignment, % folded in.', adopted, inserted;

  INSERT INTO project_agents_fold_ledger (handle) SELECT id FROM project_agents;

  -- 3. Every per-agent schedule must name an agent the fold carried — no silent deletes.
  SELECT count(*) INTO orphaned
    FROM cron_jobs cj
   WHERE cj.project_agent_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM agent_assignments aa WHERE aa.agent_handle = cj.project_agent_id);
  IF orphaned > 0 THEN
    RAISE EXCEPTION 'agent_assignments: % schedule(s) name an agent the fold did not carry. Refusing to continue.', orphaned;
  END IF;

  -- 4. Drop the schedule FK to project_agents (BY DISCOVERY — see 1085 for why a guessed
  --    constraint name is a trap). The new Worker writes handles that have no
  --    project_agents row; 1269 re-adds the FK against agent_assignments(agent_handle).
  FOR dep IN
    SELECT c.conname, c.conrelid::regclass AS child
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid = 'project_agents'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', dep.child, dep.conname);
    RAISE NOTICE 'agent_assignments: dropped % on %', dep.conname, dep.child;
  END LOOP;
END $$;

-- The handle is what the capability and schedule links address, so it is unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_assignments_handle
  ON agent_assignments (agent_handle);

-- A project's staffing is read on every capabilities-tab load and every run's
-- governance assembly.
CREATE INDEX IF NOT EXISTS idx_agent_assignments_project
  ON agent_assignments (tenant_id, project_id)
  WHERE project_id IS NOT NULL;

-- Keep the sequence past every handle, carried-over ones included.
SELECT setval(
  'agent_assignments_agent_handle_seq',
  GREATEST((SELECT COALESCE(MAX(agent_handle), 0) FROM agent_assignments), 1)
);
