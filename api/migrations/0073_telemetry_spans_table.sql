-- Migration: create the telemetry_spans table.
--
-- telemetry_spans holds W3C-compatible workflow trace spans forwarded from
-- CoderClaw (SpanKind = 'task.*', tool calls, model usage). It is declared in
-- schema.ts and queried by GET /api/analytics/activity-calendar (agent half of
-- the unified contribution heatmap), but it was only ever materialised via the
-- `drizzle-kit push` baseline — no tracked migration created it. Environments
-- that provision from migrations alone (e.g. production) therefore never got
-- the table, and the activity-calendar route 500s with
--   relation "telemetry_spans" does not exist
-- This migration adds the missing CREATE so every environment converges.
--
-- IF NOT EXISTS keeps it idempotent and safe where the push baseline already
-- created the table. segment_id is added in a second step that mirrors 0056
-- exactly: 0056 runs BEFORE this migration and skips telemetry_spans when the
-- table is absent (its to_regclass guard), so the column + default-fill trigger
-- + NOT NULL must be (re)applied here. set_default_segment_id() is defined in
-- 0056, which always runs first.

CREATE TABLE IF NOT EXISTS telemetry_spans (
  id                            SERIAL PRIMARY KEY,
  tenant_id                     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claw_id                       INTEGER REFERENCES coderclaw_instances(id) ON DELETE SET NULL,
  trace_id                      VARCHAR(32) NOT NULL,
  workflow_id                   VARCHAR(36),
  task_id                       VARCHAR(36),
  kind                          VARCHAR(64) NOT NULL,
  agent_role                    VARCHAR(255),
  description                   TEXT,
  duration_ms                   INTEGER,
  model                         VARCHAR(255),
  input_tokens                  INTEGER,
  output_tokens                 INTEGER,
  estimated_cost_usd_millicents INTEGER,
  error                         TEXT,
  ts                            TIMESTAMP NOT NULL,
  created_at                    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Query-pattern indexes for the activity-calendar aggregation (tenant + time
-- range, grouped by claw).
CREATE INDEX IF NOT EXISTS idx_telemetry_spans_tenant_ts ON telemetry_spans(tenant_id, ts);
CREATE INDEX IF NOT EXISTS idx_telemetry_spans_claw ON telemetry_spans(claw_id);

-- segment_id propagation — mirrors 0056 (which skipped this table when absent).
-- Ordering: ADD COLUMN -> CREATE TRIGGER -> backfill -> SET NOT NULL, so the
-- column is never NOT NULL without the default-fill trigger in place.
DO $$ BEGIN
  IF to_regclass('public.telemetry_spans') IS NOT NULL THEN
    ALTER TABLE telemetry_spans ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_telemetry_spans_segment ON telemetry_spans;
    CREATE TRIGGER trg_telemetry_spans_segment BEFORE INSERT ON telemetry_spans FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE telemetry_spans x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE telemetry_spans ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_telemetry_spans_segment ON telemetry_spans(segment_id);
  END IF;
END $$;
