-- 1346 · SIEM export (PRD 39 §4a).
--
-- Extends otel_exporters with the two things the audit sweep needs:
--   • `signals` — which signals this exporter ships: 'traces', 'audit', or 'both'.
--     Defaults to 'traces', so nothing changes for existing rows.
--   • `audit_cursor` — per-exporter, per-source sweep positions. One JSONB object
--     keeps every source's cursor in one place ({source: lastSeenId} plus a
--     `sent` tally); updating the whole object is one row write instead of one row
--     per source, and the exporter row and its cursor share one lifecycle
--     (deleting the exporter deletes the cursor). A separate cursor table is the
--     heavier model and buys nothing here.
--
-- `logs_url` is NOT stored: it is derived from `endpoint` at send time —
-- swapping any `/v1/traces` or `/v1/metrics` suffix for `/v1/logs` in code, so an
-- endpoint change never leaves a stale stored logs URL behind.

ALTER TABLE otel_exporters ADD COLUMN IF NOT EXISTS signals VARCHAR(16) NOT NULL DEFAULT 'traces';
ALTER TABLE otel_exporters ADD COLUMN IF NOT EXISTS audit_cursor JSONB;

COMMENT ON COLUMN otel_exporters.signals IS 'Which signals this exporter ships: traces, audit, or both. Defaults to traces, so existing exporters are unchanged.';
COMMENT ON COLUMN otel_exporters.audit_cursor IS 'Per-source sweep positions ({source: lastSeenId, sent: n}). One row per exporter so deleting the exporter deletes the cursor; see application/observability/otelAuditSweep.ts.';

-- 1346 · Release note: SIEM export (PRD 39 §4a). `category=new`.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0017-4000-8000-000000001346',
    '2026.11.150',
    'Ship your audit trail to your SIEM',
    'Security and audit events could not leave the platform: agent-run spans went to your collector, but sign-ins, role and membership changes, API key changes, exports, integration connections, approval decisions and agent tool calls stayed inside. Now any OpenTelemetry exporter can also ship audit events as OTLP logs to your collector''s logs endpoint. An exporter says which signals it ships — traces, audit, or both — so your existing trace exporters keep working unchanged. Delivery is at-least-once with each event''s id as the dedup key, and a per-source cursor means a failed batch is retried from exactly where it stopped with no loss and no duplicates. The sweep runs on a background schedule, never on a request path, so a collector outage never slows your workspace — and the exporter row in Settings shows the failure the moment it starts. Tenant export carries only that tenant''s events; the operator trail never leaves the platform. Available in English, Chinese, Spanish, French and German.',
    'new',
    'live',
    '2026-11-15 10:00:00'
  )
ON CONFLICT (id) DO NOTHING;
