-- 0234_alerts.sql
-- Threshold ALERTS subsystem — the "set up alerts" Jellyfish-parity gap + the
-- logged "no alerting subsystem / eval drift only console.warn" gap.
--
-- 1. alerts — user-defined threshold rules on platform metrics (token spend,
--    cost-per-merged-PR, DORA keys, AI effectiveness, eval drift). A scheduled
--    daily sweep (runAlertSweep) evaluates each enabled rule, and when the
--    comparator(observed, threshold) is true (and the cooldown has elapsed) it
--    raises an alert_event and notifies via the existing Slack/email channels.
--    tenant+segment scoped (uuid PK) like the other planning trackers; the
--    segment trigger defaults segment_id on insert.
--
-- 2. alert_events — the firing log (one row per time a rule trips, plus the
--    system 'eval_drift' alerts which always fire without a rule). Carries the
--    observed value, the threshold it crossed, the notification delivery flags,
--    and an acknowledge lifecycle. Idempotent / re-runnable.

CREATE TABLE IF NOT EXISTS alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id        UUID REFERENCES segments(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  metric            VARCHAR(40) NOT NULL,                 -- token_spend_usd | token_spend_pct_of_cap | cost_per_merged_pr_usd | dora_change_failure_rate | dora_lead_time_hours | ai_effectiveness_score | eval_drift
  comparator        VARCHAR(4) NOT NULL,                  -- gt | lt | gte | lte
  threshold         REAL NOT NULL DEFAULT 0,
  window_days       INTEGER NOT NULL DEFAULT 7,
  scope_kind        VARCHAR(16) NOT NULL DEFAULT 'tenant',-- tenant | project | team
  project_id        INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  team_id           INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  notify_slack      BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email      BOOLEAN NOT NULL DEFAULT TRUE,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  cooldown_hours    INTEGER NOT NULL DEFAULT 24,
  last_triggered_at TIMESTAMP,
  last_evaluated_at TIMESTAMP,
  created_by        VARCHAR(36),
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_enabled
  ON alerts(tenant_id, enabled);

DROP TRIGGER IF EXISTS trg_alerts_segment ON alerts;
CREATE TRIGGER trg_alerts_segment
  BEFORE INSERT ON alerts
  FOR EACH ROW
  EXECUTE FUNCTION set_default_segment_id();

-- ── Alert firings (the event log) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        UUID REFERENCES alerts(id) ON DELETE CASCADE,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric          VARCHAR(40),
  observed_value  REAL,
  threshold       REAL,
  comparator      VARCHAR(4),
  message         TEXT NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'triggered', -- triggered | acknowledged | resolved
  notified_slack  BOOLEAN DEFAULT FALSE,
  notified_email  BOOLEAN DEFAULT FALSE,
  acknowledged_by VARCHAR(36),
  acknowledged_at TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alert_events_tenant_created
  ON alert_events(tenant_id, created_at DESC);
