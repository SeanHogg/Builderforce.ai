-- 1269 — CONTRACT half of 1265: retire `project_agents` for good.
--
-- Ship ONLY after the Worker that reads `agent_assignments` (1265's code) is live. Until
-- then the old Worker may still be writing `project_agents`; this file reconciles whatever
-- it wrote during the deploy window, then drops the table and restores the schedule FK.
--
-- ── RECONCILING THE WINDOW ───────────────────────────────────────────────────
-- `project_agents_fold_ledger` (1265) lists every id the fold carried. Against it:
--   * a project_agents row NOT in the ledger was inserted by the old Worker in the window
--     → fold it now, under its own id (1265 pointed `project_agents.id` at the shared
--       handle sequence, so that id cannot collide with a handle the new Worker minted);
--     when the new Worker already holds the same assignment, that assignment adopts the
--     window id if only the window row carries links, and otherwise the window row's
--     capabilities and schedules are merged onto the assignment's handle (re-keying it
--     would orphan the links the new Worker hung off its own handle);
--   * a ledger id NO LONGER in project_agents was detached by the old Worker
--     → remove the assignment, its per-agent capabilities and its per-agent schedules
--       (the cascade the old FK would have performed, suspended during the window);
--   * a ledger id still in project_agents but gone from agent_assignments was removed by
--     the NEW Worker → leave it gone; it is not resurrected;
--   * governance the old Worker edited in the window (project_agents.updated_at newer than
--     the assignment's) is carried across.
--
-- Fails LOUDLY if a window row cannot be folded. A schedule that still names a handle no
-- assignment holds after reconciliation is deleted (with a NOTICE count): it is what the
-- restored ON DELETE CASCADE FK would have removed.

DO $$
DECLARE
  window_total  INTEGER;
  adopted       INTEGER;
  inserted      INTEGER;
  detached      INTEGER;
  dangling_cron INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'project_agents' AND table_type = 'BASE TABLE'
  ) THEN
    RETURN;  -- already contracted
  END IF;

  -- 1. ROWS THE OLD WORKER DETACHED IN THE WINDOW — finish the suspended cascade.
  --    FIRST, before any window row is matched: when the old Worker detached an agent
  --    and attached it again, the re-attachment is a window row with the same key as the
  --    detached row's assignment. Matching it against that assignment (then deleting the
  --    assignment here) would drop the re-attachment and any links merged onto it.
  DELETE FROM artifact_assignments ar
   USING project_agents_fold_ledger l
   WHERE ar.scope = 'agent'
     AND ar.scope_id = l.handle
     AND NOT EXISTS (SELECT 1 FROM project_agents pa WHERE pa.id = l.handle);
  DELETE FROM cron_jobs cj
   USING project_agents_fold_ledger l
   WHERE cj.project_agent_id = l.handle
     AND NOT EXISTS (SELECT 1 FROM project_agents pa WHERE pa.id = l.handle);
  DELETE FROM agent_assignments aa
   USING project_agents_fold_ledger l
   WHERE aa.agent_handle = l.handle
     AND aa.scope IN ('project', 'workspace')
     AND NOT EXISTS (SELECT 1 FROM project_agents pa WHERE pa.id = l.handle);
  GET DIAGNOSTICS detached = ROW_COUNT;
  RAISE NOTICE 'project_agents contract: % assignment(s) detached by the old Worker in the window removed.', detached;

  -- 2. ROWS THE OLD WORKER ADDED IN THE WINDOW.
  SELECT count(*) INTO window_total
    FROM project_agents pa
   WHERE NOT EXISTS (SELECT 1 FROM project_agents_fold_ledger l WHERE l.handle = pa.id);

  UPDATE agent_assignments aa
     SET agent_handle = pa.id,
         project_id   = COALESCE(aa.project_id, pa.project_id),
         name         = COALESCE(aa.name, pa.name),
         governance   = COALESCE(aa.governance, pa.governance),
         added_by     = COALESCE(aa.added_by, pa.added_by),
         updated_at   = GREATEST(aa.updated_at, pa.updated_at)
    FROM project_agents pa
   WHERE NOT EXISTS (SELECT 1 FROM project_agents_fold_ledger l WHERE l.handle = pa.id)
     AND NOT EXISTS (SELECT 1 FROM agent_assignments x WHERE x.agent_handle = pa.id)
     AND aa.tenant_id  = pa.tenant_id
     AND aa.agent_kind = pa.agent_kind
     AND aa.agent_ref  = pa.agent_ref
     AND (
           (pa.project_id IS NOT NULL AND aa.scope = 'project'   AND aa.scope_id = pa.project_id::text)
        OR (pa.project_id IS NULL     AND aa.scope = 'workspace' AND aa.scope_id IS NULL)
         )
     -- An assignment the new Worker created keeps its own handle only when nothing
     -- references the window row's id; otherwise it adopts that id so links follow.
     AND (
           EXISTS (SELECT 1 FROM artifact_assignments ar WHERE ar.scope = 'agent' AND ar.scope_id = pa.id)
        OR EXISTS (SELECT 1 FROM cron_jobs cj WHERE cj.project_agent_id = pa.id)
         )
     -- ...and only when nothing references the assignment's OWN handle, which re-keying
     -- would orphan. When both sides carry links, step 2b merges them instead.
     AND NOT EXISTS (SELECT 1 FROM artifact_assignments ar WHERE ar.scope = 'agent' AND ar.scope_id = aa.agent_handle)
     AND NOT EXISTS (SELECT 1 FROM cron_jobs cj WHERE cj.project_agent_id = aa.agent_handle);
  GET DIAGNOSTICS adopted = ROW_COUNT;

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
  WHERE NOT EXISTS (SELECT 1 FROM project_agents_fold_ledger l WHERE l.handle = pa.id)
    AND NOT EXISTS (SELECT 1 FROM agent_assignments aa WHERE aa.agent_handle = pa.id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  -- 2b. A window row that matched an existing assignment but could not lend it its id
  --     (both carried links) hands its links to that assignment's handle: capabilities
  --     the assignment already holds are kept once, the rest move, and its schedules move.
  UPDATE artifact_assignments ar
     SET scope_id = aa.agent_handle
    FROM project_agents pa
    JOIN agent_assignments aa
      ON aa.tenant_id = pa.tenant_id AND aa.agent_kind = pa.agent_kind AND aa.agent_ref = pa.agent_ref
     AND ((pa.project_id IS NOT NULL AND aa.scope = 'project' AND aa.scope_id = pa.project_id::text)
       OR (pa.project_id IS NULL AND aa.scope = 'workspace' AND aa.scope_id IS NULL))
   WHERE ar.scope = 'agent'
     AND ar.scope_id = pa.id
     AND NOT EXISTS (SELECT 1 FROM project_agents_fold_ledger l WHERE l.handle = pa.id)
     AND NOT EXISTS (SELECT 1 FROM agent_assignments x WHERE x.agent_handle = pa.id)
     AND NOT EXISTS (
       SELECT 1 FROM artifact_assignments dup
        WHERE dup.tenant_id = ar.tenant_id AND dup.artifact_type = ar.artifact_type
          AND dup.artifact_slug = ar.artifact_slug AND dup.scope = 'agent'
          AND dup.scope_id = aa.agent_handle);
  UPDATE cron_jobs cj
     SET project_agent_id = aa.agent_handle
    FROM project_agents pa
    JOIN agent_assignments aa
      ON aa.tenant_id = pa.tenant_id AND aa.agent_kind = pa.agent_kind AND aa.agent_ref = pa.agent_ref
     AND ((pa.project_id IS NOT NULL AND aa.scope = 'project' AND aa.scope_id = pa.project_id::text)
       OR (pa.project_id IS NULL AND aa.scope = 'workspace' AND aa.scope_id IS NULL))
   WHERE cj.project_agent_id = pa.id
     AND NOT EXISTS (SELECT 1 FROM project_agents_fold_ledger l WHERE l.handle = pa.id)
     AND NOT EXISTS (SELECT 1 FROM agent_assignments x WHERE x.agent_handle = pa.id);
  -- What is left under such a window id duplicates a capability the assignment holds.
  DELETE FROM artifact_assignments ar
   USING project_agents pa
   WHERE ar.scope = 'agent'
     AND ar.scope_id = pa.id
     AND NOT EXISTS (SELECT 1 FROM project_agents_fold_ledger l WHERE l.handle = pa.id)
     AND NOT EXISTS (SELECT 1 FROM agent_assignments x WHERE x.agent_handle = pa.id);

  -- A window row that matched an existing assignment with nothing hanging off it is
  -- the same staffing fact — counted as reconciled, not lost.
  IF (
    SELECT count(*) FROM project_agents pa
     WHERE NOT EXISTS (SELECT 1 FROM project_agents_fold_ledger l WHERE l.handle = pa.id)
       AND NOT EXISTS (SELECT 1 FROM agent_assignments aa WHERE aa.agent_handle = pa.id)
       AND NOT EXISTS (
         SELECT 1 FROM agent_assignments aa
          WHERE aa.tenant_id = pa.tenant_id AND aa.agent_kind = pa.agent_kind AND aa.agent_ref = pa.agent_ref
            AND ((pa.project_id IS NOT NULL AND aa.scope = 'project' AND aa.scope_id = pa.project_id::text)
              OR (pa.project_id IS NULL AND aa.scope = 'workspace' AND aa.scope_id IS NULL)))
  ) > 0 THEN
    RAISE EXCEPTION 'project_agents contract: window rows could not be folded (% in window, % adopted, % folded). Refusing to drop.',
      window_total, adopted, inserted;
  END IF;
  RAISE NOTICE 'project_agents contract: % window row(s), % adopted, % folded.', window_total, adopted, inserted;

  -- 3. GOVERNANCE THE OLD WORKER EDITED IN THE WINDOW.
  UPDATE agent_assignments aa
     SET governance = pa.governance,
         updated_at = pa.updated_at
    FROM project_agents pa
   WHERE aa.agent_handle = pa.id
     AND pa.updated_at > aa.updated_at
     AND pa.governance IS DISTINCT FROM aa.governance;

  -- 4. Every per-agent schedule must now name a live handle. One that names a handle no
  --    assignment holds belongs to an agent that is gone: delete it, exactly what the
  --    ON DELETE CASCADE FK added below would have done had it existed through the window.
  DELETE FROM cron_jobs cj
   WHERE cj.project_agent_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM agent_assignments aa WHERE aa.agent_handle = cj.project_agent_id);
  GET DIAGNOSTICS dangling_cron = ROW_COUNT;
  RAISE NOTICE 'project_agents contract: % schedule(s) of agents no assignment holds removed (the FK cascade).', dangling_cron;

  ALTER TABLE cron_jobs
    ADD CONSTRAINT cron_jobs_project_agent_id_agent_assignments_agent_handle_fk
    FOREIGN KEY (project_agent_id) REFERENCES agent_assignments(agent_handle) ON DELETE CASCADE;

  DROP TABLE project_agents;
  DROP TABLE project_agents_fold_ledger;
END $$;

-- Keep the sequence past every handle, window rows included — and never move it
-- backwards past a value it has already handed out.
SELECT setval(
  'agent_assignments_agent_handle_seq',
  GREATEST(
    (SELECT COALESCE(MAX(agent_handle), 0) FROM agent_assignments),
    (SELECT last_value FROM agent_assignments_agent_handle_seq),
    1
  )
);
