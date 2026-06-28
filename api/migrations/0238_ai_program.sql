-- 0238_ai_program.sql
-- AI slide collectors — layered ON TOP of the existing aiImpactInsights lens
-- (adoption/comparison/productivity over llm_usage_log + run_model_outcomes).
-- That lens covers INTERNAL agent usage; the board slide also wants THIRD-PARTY
-- AI-tool adoption (Copilot/Cursor — not platform-instrumentable) and AI program
-- INVESTMENT linked to the PMO initiative tier:
--
--   ai_tool_adoption      — active/eligible users + est_hours_saved + cost per
--                           (tool, month) → AI Tools Adoption & Impact (ROI).
--   ai_program_initiatives — invested_usd linked to an initiative (0213) →
--                            AI Program Investment (Objective → Summary).
--
-- Third-party telemetry isn't connectable → manual entry. AI capacity impact /
-- FTE-equivalent stays DERIVED from run_model_outcomes (no table). Idempotent.

CREATE TABLE IF NOT EXISTS ai_tool_adoption (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  tool_name       VARCHAR(120) NOT NULL,
  category        VARCHAR(24) NOT NULL DEFAULT 'coding', -- coding | review | testing | docs | other
  period_month    VARCHAR(7) NOT NULL,                   -- 'YYYY-MM'
  active_users    INTEGER NOT NULL DEFAULT 0,
  eligible_users  INTEGER NOT NULL DEFAULT 0,
  est_hours_saved REAL NOT NULL DEFAULT 0,
  monthly_cost_usd REAL NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_tool_adoption_period ON ai_tool_adoption(tenant_id, period_month);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_tool_adoption ON ai_tool_adoption(tenant_id, tool_name, period_month);

DROP TRIGGER IF EXISTS trg_ai_tool_adoption_segment ON ai_tool_adoption;
CREATE TRIGGER trg_ai_tool_adoption_segment
  BEFORE INSERT ON ai_tool_adoption
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE TABLE IF NOT EXISTS ai_program_initiatives (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  initiative_id UUID REFERENCES initiatives(id) ON DELETE SET NULL,
  program_name  VARCHAR(255) NOT NULL,
  tier          VARCHAR(16) NOT NULL DEFAULT 'strategic', -- strategic | experiment | enablement
  invested_usd  REAL NOT NULL DEFAULT 0,
  status        VARCHAR(16) NOT NULL DEFAULT 'active',
  objective     TEXT,
  notes         TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_program_initiatives_tenant ON ai_program_initiatives(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_program_initiatives_init ON ai_program_initiatives(initiative_id);

DROP TRIGGER IF EXISTS trg_ai_program_initiatives_segment ON ai_program_initiatives;
CREATE TRIGGER trg_ai_program_initiatives_segment
  BEFORE INSERT ON ai_program_initiatives
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
