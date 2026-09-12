-- 1160 · Unify the spec's project-management spine onto the platform's owners.
--
-- DECIDED 2026-09-12 (operator): the PM spine in specs 01/04/05 is UNIFIED onto
-- `projects` / `tasks` / `specs` rather than built beside them. The spec's
-- `WorkItem` IS a `tasks` row, its `KanbanBoard`/`KanbanColumn` ARE `boards` /
-- `swimlanes`, its `Sprint`/`Delivery` IS a `sprints` row and its release plan IS a
-- `product_releases` row. Spec 01 §4–§7 now carries the mapping table.
--
-- What the spine left in this schema, and what this migration does about each:
--
--   1. String pointers where a foreign key belongs. The PRD 19/20 tables that hang
--      off a work item addressed it as `work_item_ref VARCHAR(64)` — the shape of the
--      spec's uuid-keyed `WorkItem`, which does not exist here. A task is a SERIAL
--      `tasks.id`; a sprint is `sprints.id` (uuid); a project is a SERIAL
--      `projects.id`. Each pointer becomes a real, typed column:
--        task_effort_estimates.work_item_ref   -> task_id           (FK tasks, CASCADE)
--        task_time_entries.work_item_ref       -> task_id           (FK tasks, CASCADE)
--        action_items.promoted_work_item_ref   -> promoted_task_id  (FK tasks, SET NULL)
--        product_ideas.promoted_work_item_ref  -> promoted_task_id  (FK tasks, SET NULL)
--        sprint_financial_impact.sprint_ref    -> sprint_id         (FK sprints, CASCADE)
--        sprint_financial_impact.project_ref   -> (retired: the sprint names its project)
--        bottleneck_analysis.project_ref       -> project_id        (FK projects, CASCADE)
--      A ref is resolved the two ways a caller could have written it — the numeric
--      id or the human key (`tasks.key`, `projects.key`) — and only inside its own
--      tenant, so a pointer can never be backfilled across a tenant boundary.
--
--   2. Two duplicate owners, already classified `transform` by the PRD 19 §9 parity
--      register ("duplicate of a richer Builderforce owner"):
--        kanban_columns -> swimlanes         (folded, then dropped)
--        release_plans  -> product_releases  (folded, then dropped)
--      `swimlanes` gains the two KanbanColumn attributes it had no home for —
--      `wip_limit` and `color_token` — as columns, not a table (spec 01 §6).
--      `release_plans`' registered kernel `objects` rows are RE-POINTED at the new
--      `product_releases` row, so any annotation / share link on a plan survives.
--
-- DATA-PRESERVING BY CONSTRUCTION. Every drop is preceded by a backfill, and every
-- backfill is followed by a check that RAISES — rolling the whole file back, since
-- scripts/migrate.mjs applies a file in one transaction — if any row could not be
-- carried. A pointer that names no task in its tenant is a row a person must look
-- at, not one a migration may discard.
--
-- Idempotent: every step is guarded on the column / table it consumes still
-- existing, so a replay against a database that already applied it is a no-op.

-- ── 1a. task_effort_estimates.work_item_ref -> task_id ──────────────────────────
ALTER TABLE task_effort_estimates ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE;
DO $$
DECLARE unresolved INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'task_effort_estimates' AND column_name = 'work_item_ref') THEN
    UPDATE task_effort_estimates e SET task_id = t.id
      FROM tasks t
     WHERE e.task_id IS NULL
       AND t.tenant_id = e.tenant_id
       AND (t.id::text = btrim(e.work_item_ref) OR t.key = btrim(e.work_item_ref));
    SELECT count(*) INTO unresolved FROM task_effort_estimates WHERE task_id IS NULL;
    IF unresolved > 0 THEN
      RAISE EXCEPTION '1160: % task_effort_estimates row(s) carry a work_item_ref that names no task in their tenant; resolve them before the column is dropped', unresolved;
    END IF;
    DROP INDEX IF EXISTS idx_task_effort_estimates_item;
    ALTER TABLE task_effort_estimates DROP COLUMN work_item_ref;
  END IF;
END $$;
ALTER TABLE task_effort_estimates ALTER COLUMN task_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_effort_estimates_task ON task_effort_estimates (tenant_id, task_id, estimated_at);

-- ── 1b. task_time_entries.work_item_ref -> task_id ──────────────────────────────
ALTER TABLE task_time_entries ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE;
DO $$
DECLARE unresolved INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'task_time_entries' AND column_name = 'work_item_ref') THEN
    UPDATE task_time_entries e SET task_id = t.id
      FROM tasks t
     WHERE e.task_id IS NULL
       AND t.tenant_id = e.tenant_id
       AND (t.id::text = btrim(e.work_item_ref) OR t.key = btrim(e.work_item_ref));
    SELECT count(*) INTO unresolved FROM task_time_entries WHERE task_id IS NULL;
    IF unresolved > 0 THEN
      RAISE EXCEPTION '1160: % task_time_entries row(s) carry a work_item_ref that names no task in their tenant; resolve them before the column is dropped', unresolved;
    END IF;
    DROP INDEX IF EXISTS idx_task_time_entries_item;
    ALTER TABLE task_time_entries DROP COLUMN work_item_ref;
  END IF;
END $$;
ALTER TABLE task_time_entries ALTER COLUMN task_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_time_entries_task ON task_time_entries (tenant_id, task_id, started_at);

-- ── 1c. action_items.promoted_work_item_ref -> promoted_task_id ─────────────────
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS promoted_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
DO $$
DECLARE unresolved INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'action_items' AND column_name = 'promoted_work_item_ref') THEN
    UPDATE action_items a SET promoted_task_id = t.id
      FROM tasks t
     WHERE a.promoted_task_id IS NULL
       AND a.promoted_work_item_ref IS NOT NULL
       AND t.tenant_id = a.tenant_id
       AND (t.id::text = btrim(a.promoted_work_item_ref) OR t.key = btrim(a.promoted_work_item_ref));
    SELECT count(*) INTO unresolved FROM action_items
     WHERE promoted_work_item_ref IS NOT NULL AND promoted_task_id IS NULL;
    IF unresolved > 0 THEN
      RAISE EXCEPTION '1160: % action_items row(s) were promoted to a work_item_ref that names no task in their tenant; resolve them before the column is dropped', unresolved;
    END IF;
    ALTER TABLE action_items DROP COLUMN promoted_work_item_ref;
  END IF;
END $$;

-- ── 1d. product_ideas.promoted_work_item_ref -> promoted_task_id ────────────────
-- The foreign key is real and lives HERE, not on the Drizzle declaration: product
-- ideas are the Investor domain and tasks are Delivery, and a `.references()` in
-- schema/investor.ts would open the cross-domain edge check-domain-boundary counts
-- (the `projects.company_id` precedent, migration 1120).
ALTER TABLE product_ideas ADD COLUMN IF NOT EXISTS promoted_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
DO $$
DECLARE unresolved INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'product_ideas' AND column_name = 'promoted_work_item_ref') THEN
    UPDATE product_ideas i SET promoted_task_id = t.id
      FROM tasks t
     WHERE i.promoted_task_id IS NULL
       AND i.promoted_work_item_ref IS NOT NULL
       AND t.tenant_id = i.tenant_id
       AND (t.id::text = btrim(i.promoted_work_item_ref) OR t.key = btrim(i.promoted_work_item_ref));
    SELECT count(*) INTO unresolved FROM product_ideas
     WHERE promoted_work_item_ref IS NOT NULL AND promoted_task_id IS NULL;
    IF unresolved > 0 THEN
      RAISE EXCEPTION '1160: % product_ideas row(s) were promoted to a work_item_ref that names no task in their tenant; resolve them before the column is dropped', unresolved;
    END IF;
    ALTER TABLE product_ideas DROP COLUMN promoted_work_item_ref;
  END IF;
END $$;

-- ── 1e. sprint_financial_impact.sprint_ref -> sprint_id; project_ref retired ─────
-- `project_ref` is NOT carried as a column: a sprint already names its project
-- (`sprints.project_id`), so a project on the cost row would be a transitive
-- dependency that can disagree with the sprint it costs. It is dropped only after
-- proving every stored value AGREES with the sprint's own project.
ALTER TABLE sprint_financial_impact ADD COLUMN IF NOT EXISTS sprint_id UUID REFERENCES sprints(id) ON DELETE CASCADE;
DO $$
DECLARE unresolved INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'sprint_financial_impact' AND column_name = 'sprint_ref') THEN
    UPDATE sprint_financial_impact f SET sprint_id = s.id
      FROM sprints s
     WHERE f.sprint_id IS NULL
       AND s.tenant_id = f.tenant_id
       AND s.id::text = btrim(f.sprint_ref);
    SELECT count(*) INTO unresolved FROM sprint_financial_impact WHERE sprint_id IS NULL;
    IF unresolved > 0 THEN
      RAISE EXCEPTION '1160: % sprint_financial_impact row(s) name a sprint that does not exist in their tenant; resolve them before the column is dropped', unresolved;
    END IF;
    SELECT count(*) INTO unresolved
      FROM sprint_financial_impact f
      JOIN sprints s ON s.id = f.sprint_id
      LEFT JOIN projects p ON p.id = s.project_id
     WHERE f.project_ref IS NOT NULL AND btrim(f.project_ref) <> ''
       AND (p.id IS NULL OR (p.id::text <> btrim(f.project_ref) AND p.key <> btrim(f.project_ref)));
    IF unresolved > 0 THEN
      RAISE EXCEPTION '1160: % sprint_financial_impact row(s) carry a project_ref that disagrees with their sprint''s project; resolve them before the column is dropped', unresolved;
    END IF;
    DROP INDEX IF EXISTS uq_sprint_financial_impact_sprint;
    ALTER TABLE sprint_financial_impact DROP COLUMN sprint_ref;
    ALTER TABLE sprint_financial_impact DROP COLUMN project_ref;
  END IF;
END $$;
ALTER TABLE sprint_financial_impact ALTER COLUMN sprint_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sprint_financial_impact_sprint_id ON sprint_financial_impact (tenant_id, sprint_id);

-- ── 1f. bottleneck_analysis.project_ref -> project_id ───────────────────────────
ALTER TABLE bottleneck_analysis ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
DO $$
DECLARE unresolved INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'bottleneck_analysis' AND column_name = 'project_ref') THEN
    UPDATE bottleneck_analysis b SET project_id = p.id
      FROM projects p
     WHERE b.project_id IS NULL
       AND b.project_ref IS NOT NULL
       AND p.tenant_id = b.tenant_id
       AND (p.id::text = btrim(b.project_ref) OR p.key = btrim(b.project_ref));
    SELECT count(*) INTO unresolved FROM bottleneck_analysis
     WHERE project_ref IS NOT NULL AND btrim(project_ref) <> '' AND project_id IS NULL;
    IF unresolved > 0 THEN
      RAISE EXCEPTION '1160: % bottleneck_analysis row(s) name a project that does not exist in their tenant; resolve them before the column is dropped', unresolved;
    END IF;
    DROP INDEX IF EXISTS uq_bottleneck_analysis_period;
    ALTER TABLE bottleneck_analysis DROP COLUMN project_ref;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bottleneck_analysis_project_period ON bottleneck_analysis (tenant_id, project_id, stage, period_start);

-- ── 1g. task_type gains 'bug' ───────────────────────────────────────────────────
-- The spec's (and BurnRateOS's) ItemType is INITIATIVE | EPIC | STORY | TASK | BUG |
-- SUBTASK. Every one but BUG already has a platform owner — `initiatives`,
-- task_type 'epic', 'task', and 'task' + `parent_task_id` — but a defect report had
-- no kind to land in, so a migrated BUG would have silently become a 'task'. A new
-- kind is a VALUE, not a table (the 0270 / 0290 / 0293 / 0325 precedent). Not used
-- in this transaction, which is what lets ADD VALUE run inside it.
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'bug';

-- ── 2a. kanban_columns -> swimlanes ─────────────────────────────────────────────
-- A lane already carries the key, name, position, terminal flag and the autonomy
-- gate. The two KanbanColumn attributes it had no home for become columns on the
-- lane. `auto_run_enabled` ("an autonomous agent may move items into this lane
-- unattended") IS the lane gate: true -> 'auto', false -> 'human', recorded as an
-- operator choice because a person set it. On a (board, key) collision the live
-- lane wins and only the attributes it lacked are filled in.
ALTER TABLE swimlanes ADD COLUMN IF NOT EXISTS wip_limit INTEGER;
ALTER TABLE swimlanes ADD COLUMN IF NOT EXISTS color_token VARCHAR(48);
DO $$
DECLARE unresolved INTEGER;
BEGIN
  IF to_regclass('public.kanban_columns') IS NOT NULL THEN
    SELECT count(*) INTO unresolved FROM kanban_columns kc
     WHERE NOT EXISTS (SELECT 1 FROM boards b
                        WHERE b.tenant_id = kc.tenant_id AND b.id::text = btrim(kc.board_ref));
    IF unresolved > 0 THEN
      RAISE EXCEPTION '1160: % kanban_columns row(s) name a board that does not exist in their tenant; resolve them before the table is folded into swimlanes', unresolved;
    END IF;
    INSERT INTO swimlanes (tenant_id, segment_id, board_id, key, name, position, is_terminal,
                           gate, gate_source, wip_limit, color_token)
    SELECT kc.tenant_id, b.segment_id, b.id, kc.key, kc.label, kc.position, kc.is_terminal,
           CASE WHEN kc.auto_run_enabled THEN 'auto' ELSE 'human' END, 'operator',
           kc.wip_limit, kc.color_token
      FROM kanban_columns kc
      JOIN boards b ON b.tenant_id = kc.tenant_id AND b.id::text = btrim(kc.board_ref)
    ON CONFLICT (board_id, key) DO UPDATE
       SET wip_limit   = COALESCE(swimlanes.wip_limit, EXCLUDED.wip_limit),
           color_token = COALESCE(swimlanes.color_token, EXCLUDED.color_token),
           updated_at  = NOW();
  END IF;
END $$;
DROP TABLE IF EXISTS kanban_columns;

-- ── 2b. release_plans -> product_releases ───────────────────────────────────────
-- Same shape, and `product_releases` is the one `tasks.release_id` points at.
-- `summary` becomes `notes`; `target_at` -> `target_date`; the two plan statuses
-- the release vocabulary lacks map onto it (frozen -> in_progress, rolled_back ->
-- cancelled) with the original recorded in `notes`, as is `blocked_by_ref`, so no
-- fact the plan held is lost. The segment is the project's; a plan with no project
-- takes the tenant default through `set_default_segment_id()`.
DO $$
DECLARE
  r RECORD;
  new_id UUID;
  pid INTEGER;
  seg UUID;
  unresolved INTEGER;
BEGIN
  IF to_regclass('public.release_plans') IS NOT NULL THEN
    SELECT count(*) INTO unresolved FROM release_plans rp
     WHERE rp.project_ref IS NOT NULL AND btrim(rp.project_ref) <> ''
       AND NOT EXISTS (SELECT 1 FROM projects p
                        WHERE p.tenant_id = rp.tenant_id
                          AND (p.id::text = btrim(rp.project_ref) OR p.key = btrim(rp.project_ref)));
    IF unresolved > 0 THEN
      RAISE EXCEPTION '1160: % release_plans row(s) name a project that does not exist in their tenant; resolve them before the table is folded into product_releases', unresolved;
    END IF;
    FOR r IN SELECT * FROM release_plans ORDER BY id LOOP
      pid := NULL;
      seg := NULL;
      IF r.project_ref IS NOT NULL AND btrim(r.project_ref) <> '' THEN
        SELECT p.id, p.segment_id INTO pid, seg FROM projects p
         WHERE p.tenant_id = r.tenant_id
           AND (p.id::text = btrim(r.project_ref) OR p.key = btrim(r.project_ref))
         LIMIT 1;
      END IF;
      new_id := gen_random_uuid();
      INSERT INTO product_releases (id, tenant_id, segment_id, project_id, name, version,
                                    target_date, released_at, release_date, status, notes,
                                    created_at, updated_at)
      VALUES (new_id, r.tenant_id, seg, pid, left(r.name, 255), left(r.version, 50),
              r.target_at, r.released_at, r.released_at,
              CASE r.status WHEN 'frozen' THEN 'in_progress'
                            WHEN 'rolled_back' THEN 'cancelled'
                            ELSE r.status END,
              NULLIF(concat_ws(E'\n\n',
                r.summary,
                CASE WHEN r.status IN ('frozen', 'rolled_back') THEN 'Release plan status: ' || r.status END,
                CASE WHEN r.blocked_by_ref IS NOT NULL THEN 'Blocked by: ' || r.blocked_by_ref END), ''),
              r.created_at, r.updated_at);
      UPDATE objects SET ref_id = new_id::text, updated_at = NOW()
       WHERE tenant_id = r.tenant_id AND kind = 'release' AND ref_id = r.id::text;
    END LOOP;
  END IF;
END $$;
DROP TABLE IF EXISTS release_plans;
