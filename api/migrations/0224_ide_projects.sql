-- IDE projects — promote "IDE project" to a first-class child entity of a Project.
--
-- Before: a `projects` row did double duty — it was BOTH the work container
-- (tasks/board/PMO/agent-hosts/source-control) AND the single IDE build unit
-- (modality/template/R2 files/datasets/training/site). That hard 1:1 meant a
-- Project could only ever be one IDE build, and "Manage LLMs"/Voice lived outside.
--
-- After: `ide_projects` is the buildable artifact you open in the IDE. Many of
-- them can hang off one Project (the optional `container_project_id`), and each
-- one is BACKED by a `projects` row (`storage_project_id`) that holds its R2
-- files/datasets/training/site/repo — so every existing IDE storage route is
-- reused unchanged. Backfill maps each existing project to exactly one ide_project
-- (storage = itself, container = none) → existing files resolve untouched, zero
-- R2 movement. New backing rows are flagged `is_ide_storage` and hidden from the
-- board/PMO project list.

-- 1) Flag projects rows that exist purely as an ide_project's storage backing, so
--    the board/PMO "/api/projects" list can exclude them. Backfilled (pre-existing)
--    projects keep FALSE and continue to appear in the board as before.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_ide_storage BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Workflow fork lineage (0224): when a shared/global workflow is modified for a
--    project it is forked into a custom copy; this records the template it came from.
ALTER TABLE workflow_definitions
  ADD COLUMN IF NOT EXISTS parent_definition_id UUID REFERENCES workflow_definitions(id) ON DELETE SET NULL;

-- 3) The ide_projects entity.
CREATE TABLE IF NOT EXISTS ide_projects (
  id                     SERIAL PRIMARY KEY,
  public_id              UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id             UUID REFERENCES segments(id) ON DELETE CASCADE,
  -- The user-facing "Project" container this build is grouped under. NULL = ungrouped.
  container_project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  -- The backing projects row that physically holds this build's R2 files / datasets
  -- / training jobs / published site / repo workspace. One ide_project ↔ one storage.
  storage_project_id     INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  name                   VARCHAR(255) NOT NULL,
  -- 'designer' | 'video' | 'llm' | 'voice'. Mirrors the storage project's modality
  -- so the existing modality-driven IDE page renders the right panels on open.
  modality               TEXT NOT NULL DEFAULT 'designer',
  status                 TEXT NOT NULL DEFAULT 'active',
  -- LLM modality requires a workflow; the assigned (possibly forked-custom) definition.
  workflow_definition_id UUID REFERENCES workflow_definitions(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ide_projects_tenant       ON ide_projects(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ide_projects_container    ON ide_projects(tenant_id, container_project_id);
CREATE INDEX IF NOT EXISTS idx_ide_projects_storage      ON ide_projects(storage_project_id);

-- 4) Backfill: every existing project becomes its own ide_project (storage = self,
--    container = none/ungrouped). is_ide_storage stays FALSE so these projects keep
--    showing in the board. Skip any project that already has an ide_project.
INSERT INTO ide_projects (tenant_id, segment_id, container_project_id, storage_project_id, name, modality, status)
SELECT p.tenant_id, p.segment_id, NULL, p.id, p.name, COALESCE(p.modality, 'designer'), 'active'
FROM projects p
WHERE NOT EXISTS (SELECT 1 FROM ide_projects ip WHERE ip.storage_project_id = p.id);

-- 5) Voice becomes a modality: a voice ide_project owns one custom voice. Link the
--    tenant-scoped voice clone to the ide_project it was enrolled under (nullable;
--    legacy clones stay tenant-wide until opened from a voice IDE project).
ALTER TABLE studio_voice_clones
  ADD COLUMN IF NOT EXISTS ide_project_id INTEGER REFERENCES ide_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_studio_voice_clones_ide_project ON studio_voice_clones(ide_project_id);
