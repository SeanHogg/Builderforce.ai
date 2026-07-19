-- 0305_forecast_anomaly_acks.sql
-- Acknowledged (dismissed) forecast anomalies. The /api/insights/forecast lens
-- flags z-score outliers on a metric's history; a manager can dismiss a point
-- that's explained/known so it stops surfacing on the panel. One row per
-- (tenant, metric, point_day). Idempotent.
--
--   metric    = cost | cycle_time | cfr | throughput  (application/insights/forecastSeries.ts)
--   point_day = 'YYYY-MM-DD' the anomaly falls on (matches the history point's day)
--
-- A metric with NO ack rows behaves exactly as before (every anomaly shown), so
-- this is purely additive.

CREATE TABLE IF NOT EXISTS forecast_anomaly_acks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  metric      VARCHAR(24) NOT NULL,          -- cost | cycle_time | cfr | throughput
  point_day   VARCHAR(10) NOT NULL,          -- 'YYYY-MM-DD' anomaly point
  note        TEXT,                          -- optional why-dismissed note
  acked_by    VARCHAR(36),                   -- users.id (nullable; machine callers null)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One dismissal per (tenant, metric, point) — the POST /forecast/ack upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_forecast_anomaly_ack
  ON forecast_anomaly_acks(tenant_id, metric, point_day);

-- Read path filters by (tenant, metric) to annotate a lens response.
CREATE INDEX IF NOT EXISTS idx_forecast_anomaly_ack_metric
  ON forecast_anomaly_acks(tenant_id, metric);
