-- 0239_rd_financials_quarterly.sql
-- INVESTMENT slide collectors — disaggregated quarterly R&D financials.
-- financeInsights (0045) covers LLM/AI spend only; allocationInsights (0226)
-- covers effort-in-TIME + capex/opex. The board's Key R&D Financials wants DOLLAR
-- spend split by category (headcount/tech_debt/hosting/COGS/internal/licenses),
-- FTE allocation by category, and a revenue ratio — none of which live in any
-- ledger (no payroll/vendor source). So a dedicated quarterly fact table per grain:
--
--   rd_financials_quarterly  — actual + plan USD per (fy, quarter, category).
--   rd_revenue_quarterly     — revenue per (fy, quarter) → Total-R&D$/Revenue.
--   rd_fte_allocation_quarterly — FTE per (fy, quarter, category) (separate grain
--                                 from dollars so neither null-pads the other).
--
-- Entered/imported (LLM + ingestion lines can auto-seed). Idempotent / re-runnable.

CREATE TABLE IF NOT EXISTS rd_financials_quarterly (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL,
  quarter     INTEGER NOT NULL,                       -- 1..4
  category    VARCHAR(24) NOT NULL,                   -- headcount | tech_debt | hosting_storage | cogs | internal | third_party_licenses
  actual_usd  REAL NOT NULL DEFAULT 0,
  plan_usd    REAL NOT NULL DEFAULT 0,
  source      VARCHAR(16) NOT NULL DEFAULT 'manual',  -- manual | llm_usage | import
  notes       TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rd_financials_fy ON rd_financials_quarterly(tenant_id, fiscal_year, quarter);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rd_financials_cat ON rd_financials_quarterly(tenant_id, fiscal_year, quarter, category);

DROP TRIGGER IF EXISTS trg_rd_financials_quarterly_segment ON rd_financials_quarterly;
CREATE TRIGGER trg_rd_financials_quarterly_segment
  BEFORE INSERT ON rd_financials_quarterly
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE TABLE IF NOT EXISTS rd_revenue_quarterly (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL,
  quarter     INTEGER NOT NULL,
  revenue_usd REAL NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rd_revenue_quarter ON rd_revenue_quarterly(tenant_id, fiscal_year, quarter);

DROP TRIGGER IF EXISTS trg_rd_revenue_quarterly_segment ON rd_revenue_quarterly;
CREATE TRIGGER trg_rd_revenue_quarterly_segment
  BEFORE INSERT ON rd_revenue_quarterly
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE TABLE IF NOT EXISTS rd_fte_allocation_quarterly (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL,
  quarter     INTEGER NOT NULL,
  category    VARCHAR(24) NOT NULL,                   -- growth | infrastructure | support | unplanned | other
  fte         REAL NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rd_fte_cat ON rd_fte_allocation_quarterly(tenant_id, fiscal_year, quarter, category);

DROP TRIGGER IF EXISTS trg_rd_fte_allocation_quarterly_segment ON rd_fte_allocation_quarterly;
CREATE TRIGGER trg_rd_fte_allocation_quarterly_segment
  BEFORE INSERT ON rd_fte_allocation_quarterly
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
