-- Diagnostics & Tools — saved runs of a free tool (calculator or questionnaire)
-- that a signed-in user chose to keep. The tool definitions are code
-- (application/tools/*); this only stores results for history/trend.

CREATE TABLE IF NOT EXISTS tool_runs (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID         REFERENCES segments(id) ON DELETE CASCADE,
  tool_id     VARCHAR(64)  NOT NULL,
  kind        VARCHAR(16)  NOT NULL DEFAULT 'self', -- self | data
  input       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  result      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_by  VARCHAR(36),
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_tool_runs_segment ON tool_runs;
CREATE TRIGGER trg_tool_runs_segment
  BEFORE INSERT ON tool_runs
  FOR EACH ROW
  EXECUTE FUNCTION set_default_segment_id();

CREATE INDEX IF NOT EXISTS idx_tool_runs_tenant_tool
  ON tool_runs(tenant_id, tool_id, created_at DESC);
