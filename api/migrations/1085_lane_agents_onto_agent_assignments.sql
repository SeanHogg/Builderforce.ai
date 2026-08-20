-- 1085 — Fold `swimlane_agent_assignments` into the canonical `agent_assignments` (0082).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- `agent_assignments` was introduced by 0082 as "the single source the surfaces
-- read, superseding the fragmented project_agents / swimlane target /
-- assignedAgentHost notions over time" — and the swimlane half never moved. So
-- "where is this agent assigned?" had two answers depending on which table you
-- asked, `scope = 'swimlane'` was a documented value with zero rows, and every
-- reader of lane staffing (14 modules, 82 references) hardcoded the second table.
--
-- ── THE COLUMNS THAT COME WITH IT ───────────────────────────────────────────
-- A lane assignment carries stage semantics no other scope has: which BACKPLANE
-- the operator staffed (`runtime`/`target`), the model pinned to that stage, the
-- capabilities it requires, its task template, and its ORDER within a sequential
-- stage. Those are added here, and they are SCOPE-QUALIFIED: null for every scope
-- but 'swimlane'. That is the shape `agent_assignments` already had — it is a
-- scoped-union table by construction (`scope` + `scope_id`), and the alternative
-- (dropping them) would delete the operator's runtime choice, which is exactly the
-- data a previous fix had to restore when the drag path ignored it.
--
-- ── THE MERGE ───────────────────────────────────────────────────────────────
-- Rows with a NULL `agent_ref` are DROPPED, not migrated: `agent_assignments`
-- requires one, and a lane assignment naming no agent could never be dispatched —
-- it was a half-written row, not a configuration. `agent_kind` defaults to
-- 'workforce', which is what every writer in the current code sets.
--
-- The old table permitted the same agent twice on one lane; the canonical unique
-- index (tenant, agent_kind, agent_ref, scope, scope_id) does not. ON CONFLICT DO
-- NOTHING keeps the FIRST by position, which is the one a sequential stage would
-- have run first anyway.
--
-- `scope_id` is varchar(64) and a swimlane id is a 36-char uuid, so it fits with
-- room to spare.

ALTER TABLE agent_assignments
  ADD COLUMN IF NOT EXISTS name                  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS runtime               VARCHAR(16),
  ADD COLUMN IF NOT EXISTS target                VARCHAR(120),
  ADD COLUMN IF NOT EXISTS task_template         TEXT,
  ADD COLUMN IF NOT EXISTS required_capabilities TEXT,
  ADD COLUMN IF NOT EXISTS model                 VARCHAR(120),
  ADD COLUMN IF NOT EXISTS position              INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'swimlane_agent_assignments') THEN
    -- `id` IS CARRIED OVER, deliberately. `agent_dispatches.assignment_id` is a real FK
    -- to the old table, so minting fresh ids would dangle every historical dispatch's
    -- link to the staffing row that produced it — which is the only record of WHICH
    -- configured agent a stage actually ran as. `ON CONFLICT DO NOTHING` covers the PK
    -- as well as the unique index, so a (vanishingly unlikely) uuid collision skips the
    -- row rather than failing the migration.
    INSERT INTO agent_assignments (
      id, tenant_id, segment_id, agent_kind, agent_ref, scope, scope_id, execution_scope,
      role, name, runtime, target, task_template, required_capabilities, model, position,
      created_at, updated_at
    )
    SELECT
      s.id,
      s.tenant_id,
      s.segment_id,
      COALESCE(s.agent_kind, 'workforce'),
      s.agent_ref,
      'swimlane',
      s.swimlane_id::text,
      'project',
      s.role,
      s.name,
      COALESCE(s.runtime, 'cloud'),
      s.target,
      s.task_template,
      s.required_capabilities,
      s.model,
      s.position,
      s.created_at,
      s.updated_at
    FROM swimlane_agent_assignments s
    WHERE s.agent_ref IS NOT NULL
    ORDER BY s.swimlane_id, s.position, s.created_at
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'agent_assignments: folded % swimlane assignment(s) in.',
      (SELECT count(*) FROM agent_assignments WHERE scope = 'swimlane');

    -- Re-point the dispatch FK BEFORE the drop, so no dispatch loses its staffing link.
    ALTER TABLE agent_dispatches DROP CONSTRAINT IF EXISTS agent_dispatches_assignment_id_swimlane_agent_assignments_id_fk;
    ALTER TABLE agent_dispatches
      ADD CONSTRAINT agent_dispatches_assignment_id_agent_assignments_id_fk
      FOREIGN KEY (assignment_id) REFERENCES agent_assignments(id) ON DELETE SET NULL;

    DROP TABLE swimlane_agent_assignments;
  END IF;
END $$;

-- Lane staffing is read per-lane on every autonomy evaluation, so give that access
-- path its own index rather than leaning on the generic (tenant, scope, scope_id)
-- one — the ordering matters for a sequential stage.
CREATE INDEX IF NOT EXISTS idx_agent_assignments_lane
  ON agent_assignments (scope_id, position)
  WHERE scope = 'swimlane';
