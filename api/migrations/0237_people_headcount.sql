-- 0237_people_headcount.sql
-- PEOPLE slide collectors — the headcount time-series nothing else collects.
-- Developer satisfaction is ALREADY collected (devex_surveys, 0229) and new-hire
-- ramp rides member_profiles.ramp_factor (0116) — so this only adds:
--
--   headcount_events — append-only hire/leave/transfer; is_voluntary (leave only)
--                      splits voluntary vs involuntary → Headcount Waterfall +
--                      Attrition Rate.
--   open_positions   — High Priority Open Positions; days_open = today − opened_on.
--
-- No HRIS/ATS connector exists → manual entry (the generic tracker drives CRUD).
-- Idempotent / re-runnable. tenant + segment scoped via set_default_segment_id().

CREATE TABLE IF NOT EXISTS headcount_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  member_kind  VARCHAR(16) NOT NULL DEFAULT 'human', -- human | cloud_agent | host_agent
  member_ref   VARCHAR(255),
  member_name  VARCHAR(255),
  event_type   VARCHAR(16) NOT NULL,                 -- hire | leave | transfer
  team_id      INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  effective_on DATE NOT NULL,
  is_voluntary BOOLEAN,                              -- leave only
  reason       TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_headcount_events_effective ON headcount_events(tenant_id, effective_on);

DROP TRIGGER IF EXISTS trg_headcount_events_segment ON headcount_events;
CREATE TRIGGER trg_headcount_events_segment
  BEFORE INSERT ON headcount_events
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE TABLE IF NOT EXISTS open_positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  req_title       VARCHAR(255) NOT NULL,
  team_id         INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  priority        VARCHAR(16) NOT NULL DEFAULT 'normal', -- high | normal | low
  status          VARCHAR(16) NOT NULL DEFAULT 'open',   -- open | filled | on_hold | cancelled
  opened_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  target_start_on DATE,
  filled_on       DATE,
  notes           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_open_positions_status ON open_positions(tenant_id, status, priority);

DROP TRIGGER IF EXISTS trg_open_positions_segment ON open_positions;
CREATE TRIGGER trg_open_positions_segment
  BEFORE INSERT ON open_positions
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
