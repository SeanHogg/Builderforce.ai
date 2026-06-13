-- 0121_pm_visualizers.sql
-- Product Management visualizers (Epics, Roadmap, ROI) under Projects.
--
-- The PM trackers (roadmap_items, feature_scores) are segment-scoped today. To
-- power BOTH a per-project view AND a segment-wide portfolio rollup we add a
-- NULLABLE project_id: NULL = portfolio/segment-level (existing rows keep their
-- meaning, so no backfill), non-null = the item belongs to one project. This
-- mirrors ceremony_sessions (0119), which already carries both segment_id and
-- project_id.
--
-- task_dependencies is the first-class blocks/blocked-by edge between tasks that
-- the dependency-map + roadmap sequencing need. Acyclicity is enforced at write
-- time in the route (a DB CHECK only stops self-loops); see taskDependencies.ts.
--
-- Idempotent / re-runnable: columns + table IF NOT EXISTS, indexes IF NOT EXISTS.

-- ── dual-scope the two PM trackers that drive project-level visualizers ───────
ALTER TABLE roadmap_items  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE feature_scores ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_roadmap_items_scope  ON roadmap_items(tenant_id, segment_id, project_id);
CREATE INDEX IF NOT EXISTS idx_feature_scores_scope ON feature_scores(tenant_id, segment_id, project_id);

-- ── first-class task dependency edges (DAG) ──────────────────────────────────
-- predecessor_task_id must finish before successor_task_id can start
-- (dep_type reserved for SS/FF/SF semantics later; finish_to_start for now).
CREATE TABLE IF NOT EXISTS task_dependencies (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id          UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  predecessor_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  successor_task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dep_type            VARCHAR(16) NOT NULL DEFAULT 'finish_to_start',
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT task_dependencies_no_self CHECK (predecessor_task_id <> successor_task_id),
  CONSTRAINT task_dependencies_unique_edge UNIQUE (predecessor_task_id, successor_task_id)
);

DROP TRIGGER IF EXISTS trg_task_dependencies_segment ON task_dependencies;
CREATE TRIGGER trg_task_dependencies_segment BEFORE INSERT ON task_dependencies FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE task_dependencies x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE task_dependencies ALTER COLUMN segment_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_deps_predecessor ON task_dependencies(predecessor_task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_successor   ON task_dependencies(successor_task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_project     ON task_dependencies(project_id);
