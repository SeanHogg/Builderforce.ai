-- 0233_devfinops.sql
-- DevFinOps completion — three marketing capabilities turned real:
--   R&D Tax Credits   → rd_tax_credit_config (per-tenant QRE definition: which
--                        allocation categories / action types count as Qualified
--                        Research + a blended labor rate). The QRE rollup itself is
--                        DERIVED on the fly from the allocation lens + llm_usage_log.
--   SOC 1 Type II     → soc_controls (a per-tenant controls register; each row is a
--                        control objective + assertion the manager maintains). The
--                        evidence pack reuses tool_audit_events (no new table).
--   Audit-Ready Report→ audit_report_runs (optional record of an assembled period
--                        report; the report is computed live, this just logs runs).
--
-- All tenant-scoped (no segment). Idempotent.

-- ── R&D Tax Credit config (one row per tenant) ───────────────────────────────
CREATE TABLE IF NOT EXISTS rd_tax_credit_config (
  tenant_id              INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  qualified_categories   JSONB NOT NULL DEFAULT '["innovation","tech_debt"]'::jsonb,
  blended_labor_rate_usd REAL  NOT NULL DEFAULT 95,
  qualified_action_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at             TIMESTAMP NOT NULL DEFAULT now()
);

-- ── SOC 1 Type II controls register ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS soc_controls (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  control_ref   VARCHAR(32)  NOT NULL,
  objective     VARCHAR(240) NOT NULL,
  category      VARCHAR(48)  NOT NULL DEFAULT 'general',
  status        VARCHAR(16)  NOT NULL DEFAULT 'gap',  -- implemented | partial | gap
  owner         VARCHAR(120),
  note          TEXT DEFAULT '',
  last_reviewed TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_soc_controls_tenant ON soc_controls(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_soc_controls_ref ON soc_controls(tenant_id, control_ref);

-- ── Audit-ready report runs (log of assembled period reports) ────────────────
CREATE TABLE IF NOT EXISTS audit_report_runs (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_month  VARCHAR(7) NOT NULL,    -- 'YYYY-MM'
  generated_by  VARCHAR(36),
  summary       JSONB,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_report_runs_tenant ON audit_report_runs(tenant_id, period_month);
