-- 0033 · Run outcomes — time indexes (PRD 41 §D1, WS16). EXPAND ONLY.
--
-- The run-outcomes reads are windowed by time and had no index to range-scan:
--   • run_features (finalized_at)             — the cross-tenant training read (`finalized_at >= since`)
--                                               and the 730-day retention sweep;
--   • run_features (tenant_id, finalized_at)  — the tenant training read and the per-tenant ranked
--                                               cross-tenant read (partition by tenant, order by time);
--   • run_outcome_labels (computed_at)        — the label retention sweep;
--   • run_commit_attributions (committed_at)  — the label sweep's "tenants with recent runs" scan and
--                                               the retention sweep.
-- Mirrored on the primary track by migrations/1345_run_outcome_time_indexes.sql and in the Drizzle
-- schema (schema/runOutcomes.ts). No CONCURRENTLY: the runner wraps each file in one transaction.

CREATE INDEX IF NOT EXISTS idx_run_features_finalized_at ON run_features (finalized_at);
CREATE INDEX IF NOT EXISTS idx_run_features_tenant_finalized_at ON run_features (tenant_id, finalized_at);
CREATE INDEX IF NOT EXISTS idx_run_outcome_labels_computed_at ON run_outcome_labels (computed_at);
CREATE INDEX IF NOT EXISTS idx_run_commit_attributions_committed_at ON run_commit_attributions (committed_at);
