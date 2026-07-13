-- 0211_designer_repo_and_tenant_models.sql
--
-- Three additions that turn the web Designer into a real, repo-backed IDE and
-- introduce the tenant "LLM" (a reusable, named model config):
--
--   1. projects.origin            — where a project was born, drives the IDE badge.
--   2. project_repositories.last_synced_* — the import baseline so the Designer's
--      "commit back" can diff the R2 workspace against the ref it imported from.
--   3. tenant_models              — the "LLM" object: a tenant-scoped, named bundle
--      of { base model + system prompt + params (+ optional persona / BYO key /
--      future trained model) } that any cloud agent, on-prem host, or the Designer
--      can select by ref `tenant_model:<slug>`.
--
-- Idempotent: guarded with IF NOT EXISTS so re-running is safe.

-- 1. Project origin (badge). 'ide' = created in the Designer, 'imported' = created
--    by importing a repo, 'external' = everything else (default for existing rows).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin TEXT;

-- 2. Import baseline on each repo binding. When the Designer imports a repo into
--    R2 we stamp the ref + head sha + time; commit-back diffs the workspace
--    against this baseline to label created/modified/deleted.
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS last_synced_ref TEXT;
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS last_synced_sha TEXT;
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- 3. tenant_models — the "LLM" object. Tenant-scoped (mirrors marketplace_personas:
--    no segment column; tenant isolation is sufficient). A BYO key is referenced by
--    `provider_key` (the provider name, since tenant_llm_provider_keys is keyed by
--    (tenant_id, provider) and has no surrogate id). `trained_model_ref` is the seam
--    for a future trained SSM artifact to plug in as the base.
CREATE TABLE IF NOT EXISTS tenant_models (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  slug              VARCHAR(255) NOT NULL,
  -- A model id from the curated pool (CODING_MODEL_POOL); NULL = run on the
  -- tenant/plan default base, with this row contributing only prompt/params/persona.
  base_model        TEXT,
  system_prompt     TEXT,
  -- { temperature?, reasoning?, top_p?, ... } applied at run time.
  params            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- Optional persona body to compose with the system prompt.
  persona_id        UUID         REFERENCES marketplace_personas(id) ON DELETE SET NULL,
  -- Optional: route through the tenant's BYO key for this provider (e.g. 'anthropic').
  provider_key      TEXT,
  -- Future: a trained SSM model artifact used as the base.
  trained_model_ref TEXT,
  visibility        VARCHAR(16)  NOT NULL DEFAULT 'tenant',  -- 'private' | 'tenant'
  created_by        VARCHAR(36)  REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tenant_models_slug UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_tenant_models_tenant ON tenant_models(tenant_id);
