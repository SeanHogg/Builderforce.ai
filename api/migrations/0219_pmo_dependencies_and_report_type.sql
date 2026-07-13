-- 0219_pmo_dependencies_and_report_type.sql
--
-- Closes two PMO LENS #4 residual gaps (see ROADMAP):
--   (1) Dependency graph / critical path — `pmo_dependencies` are blocker→blocked
--       edges BETWEEN initiatives, so the rollup can flag blocked initiatives and
--       compute the longest incomplete chain (critical path). Cycle-safety is
--       enforced in the route (a new edge that would close a cycle is rejected).
--   (2) Scheduled portfolio exec-summary — add `portfolio_rollup` to the
--       report_type enum so a portfolio report is generatable + schedulable to
--       executive_summary parity (the report GENERATOR is wired in reportRoutes).
--
-- Idempotent / re-runnable.

CREATE TABLE IF NOT EXISTS pmo_dependencies (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id         UUID REFERENCES segments(id) ON DELETE CASCADE,
  from_initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE, -- blocker
  to_initiative_id   UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE, -- blocked
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
-- One edge per ordered pair; the route also rejects self-loops and cycles.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pmo_dependency
  ON pmo_dependencies(from_initiative_id, to_initiative_id);
CREATE INDEX IF NOT EXISTS idx_pmo_dependencies_scope
  ON pmo_dependencies(tenant_id, segment_id);

-- New schedulable/on-demand report type for the PMO portfolio rollup.
ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'portfolio_rollup';
