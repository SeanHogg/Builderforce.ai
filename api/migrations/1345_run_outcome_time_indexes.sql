-- 1345 · Run outcomes — time indexes (PRD 41 §D1, WS16) — the PRIMARY-track copy of
-- transactional-migrations/0033_run_outcome_time_indexes.sql (see it for the rationale). The tables
-- live on the operational endpoint; this copy keeps single-database environments (operational
-- handle = core handle) identical. EXPAND ONLY. No CONCURRENTLY: the runner wraps each file in one
-- transaction.

CREATE INDEX IF NOT EXISTS idx_run_features_finalized_at ON run_features (finalized_at);
CREATE INDEX IF NOT EXISTS idx_run_features_tenant_finalized_at ON run_features (tenant_id, finalized_at);
CREATE INDEX IF NOT EXISTS idx_run_outcome_labels_computed_at ON run_outcome_labels (computed_at);
CREATE INDEX IF NOT EXISTS idx_run_commit_attributions_committed_at ON run_commit_attributions (committed_at);
