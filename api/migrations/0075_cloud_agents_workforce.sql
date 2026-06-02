-- Migration 0075: workforce-created cloud agents + marketplace pricing + runtime support.
--
-- Until now `ide_agents` rows were only created by publishing a trained LoRA
-- agent FROM a project (project_id NOT NULL). The /workforce page now lets a
-- user create a cloud agent directly (no project) and publish it to the
-- marketplace for revenue. That requires:
--
--   * project_id nullable      — workforce agents aren't tied to a project
--   * tenant_id                 — owner/scope for "my agents" management
--   * price_cents / pricing_model / price_unit  — marketplace revenue (mirrors
--                                 marketplace_skills; cents to avoid float)
--   * runtime_support           — 'cloud' | 'claw' | 'both' (which runtime(s)
--                                 the agent supports)
--   * preferred_runtime         — 'cloud' | 'claw' best-experience hint (set
--                                 when runtime_support = 'both')
--   * published                 — marketplace visibility (false until published)

ALTER TABLE ide_agents ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE ide_agents
  ADD COLUMN IF NOT EXISTS tenant_id         INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS price_cents       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pricing_model     TEXT    NOT NULL DEFAULT 'flat_fee',
  ADD COLUMN IF NOT EXISTS price_unit        TEXT,
  ADD COLUMN IF NOT EXISTS runtime_support   TEXT    NOT NULL DEFAULT 'cloud',
  ADD COLUMN IF NOT EXISTS preferred_runtime TEXT,
  ADD COLUMN IF NOT EXISTS published         BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_ide_agents_tenant ON ide_agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ide_agents_published ON ide_agents(published) WHERE published = TRUE;
