-- 0286_project_baseline.sql
-- Diagnostic Questionnaire Engine — project health baseline.
--
-- This table stores per-project health baselines from the onboarding wizard and bulk import.
-- Each submission creates a VERSIONED record keyed by project_id, so multiple runs can be
-- audited; the latest version is the active baseline.
--
-- Pattern: per-project write-through FACTS store, tenant-scoped (tenant_id, project_id).
--
-- Idempotent / re-runnable: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS project_baseline (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version           integer NOT NULL DEFAULT 1,      -- increment on resubmission
  status            varchar(32) NOT NULL,            -- 'draft' | 'submitted' | 'superseded'
  completeness_score integer NOT NULL DEFAULT 0,     -- 0–100
  source             varchar(64) NOT NULL DEFAULT 'wizard', -- 'wizard' | 'bulk_import'
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_baseline UNIQUE (tenant_id, project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_project_baseline_project ON project_baseline (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_baseline_status        ON project_baseline (tenant_id, project_id, status);