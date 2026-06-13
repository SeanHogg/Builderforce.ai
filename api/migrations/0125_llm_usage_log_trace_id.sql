-- Migration: link llm_usage_log rows to their diagnostic trace.
--
-- llm_usage_log (billing/accounting) and llm_traces (full diagnostics) are
-- written one-per-call but had no shared key, so a superadmin couldn't pivot
-- from a usage/billing anomaly to its trace. Add a nullable trace_id [1299]
-- (set by the gateway chat path; null for BYO-key passthrough / image rows).
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS trace_id VARCHAR(48);

-- Pivot index: jump from a trace id to its usage row(s).
CREATE INDEX IF NOT EXISTS idx_llm_usage_log_trace_id ON llm_usage_log(trace_id);
