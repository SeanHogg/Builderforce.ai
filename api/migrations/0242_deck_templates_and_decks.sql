-- 0242_deck_templates_and_decks.sql
-- Deck generator spine — the template library + generated-deck audit/history
-- records behind the board-deck download and the Brain "generate deck" tooling.
--
--   deck_templates  — a stored template: either a GENERATIVE archetype (rendered
--                     from our branded pptxgenjs layout, no binary) or a CUSTOM
--                     uploaded .pptx (binary in R2 at r2_key) with a {{token}}→
--                     binding manifest. Built-ins live at tenant_id=0.
--   generated_decks — one rendered instance: mode (generative|fill), the R2 key
--                     of the rendered .pptx, status, and any binding warnings.
--
-- Idempotent / re-runnable. tenant_id=0 built-ins are seeded in 0243.

CREATE TABLE IF NOT EXISTS deck_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL DEFAULT 0 REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  archetype     VARCHAR(24) NOT NULL DEFAULT 'custom', -- board | cfo_devfinops | custom | generative
  r2_key        VARCHAR(512),
  manifest_json JSONB NOT NULL DEFAULT '{"version":1,"bindings":[]}'::jsonb,
  is_builtin    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    VARCHAR(36),
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deck_templates_tenant ON deck_templates(tenant_id);

CREATE TABLE IF NOT EXISTS generated_decks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id   UUID REFERENCES deck_templates(id) ON DELETE SET NULL,
  mode          VARCHAR(16) NOT NULL DEFAULT 'generative', -- generative | fill
  quarter       VARCHAR(12),
  r2_key        VARCHAR(512),
  status        VARCHAR(16) NOT NULL DEFAULT 'pending',    -- pending | ready | failed
  warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by    VARCHAR(36),
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_generated_decks_tenant ON generated_decks(tenant_id, created_at);
