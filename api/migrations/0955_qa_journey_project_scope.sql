-- 0955 — Journey events carry a PROJECT, so QA heat can be project-specific.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
-- `QaHeatmapService` said it in its own header: "Heat is tenant-wide (events
-- carry no project_id — capture runs in the app shell, not per customer site)".
-- Everything downstream of heat is project-scoped — an exploration targets one
-- project's site, a schedule has a NOT NULL project_id, findings become tasks on
-- one project's board — but the ranking that decides WHAT to explore was pooled
-- across the whole workspace. A tenant with two products therefore planned the
-- busy product's routes against the quiet product's site, and `qa_schedules`
-- rows for different projects produced identical plans.
--
-- 0068 gave project_id to qa_flows / qa_tests / qa_runs and skipped this table,
-- which is why the pipeline is project-scoped everywhere EXCEPT its source of
-- truth for attention.
--
-- ── WHY NULLABLE ────────────────────────────────────────────────────────────
-- NULL keeps the existing meaning exactly: an event captured in the Builderforce
-- app shell itself, which belongs to no customer project. Every historical row
-- is therefore correct as-is with no backfill, and a tenant-wide read (the
-- self-test exploration, the workspace heat table) still sees everything. A
-- non-null project_id narrows an event to the site it was captured on, and a
-- project-scoped read filters to it.

ALTER TABLE qa_journey_events
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;

-- Heat ranking filters (tenant_id, project_id) and windows on ts. The existing
-- (tenant_id, ts) index cannot serve the narrowed predicate, and the partial
-- index keeps the shell-capture rows (project_id IS NULL, the bulk today) out of
-- it entirely.
CREATE INDEX IF NOT EXISTS idx_qa_journey_events_project_ts
  ON qa_journey_events (tenant_id, project_id, ts)
  WHERE project_id IS NOT NULL;
