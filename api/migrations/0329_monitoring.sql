-- 0329_monitoring.sql
-- Active monitoring — the proactive front-door to incident management. The team uploads
-- a diagram / architecture image, overlays MONITOR pins on it, and when a monitor
-- breaches it opens an incident, which fires the on-call investigation loop that already
-- exists (IncidentService.openIncident → EscalationService.pageInitial →
-- dispatchIncidentTriage → RCA → Evermind).
--
--   monitoring_boards — one uploaded diagram (image stored in R2 via /api/brain/upload;
--                       we keep only the R2 key + natural dimensions for the overlay).
--   monitors          — a pin positioned on the board (pos_x/pos_y as 0..1 fractions of
--                       the image) that watches something. Types:
--                         heartbeat       — external system pings the monitor's signal
--                                           webhook on an interval; no ping in time = breach
--                         http_check      — the sweep fetches a URL; non-2xx = breach
--                         webhook         — an external tool POSTs ok/breach to the signal hook
--                         metric_threshold— reuses the alerts metric evaluator + comparator
--                         manual          — humans/agents flip it
--   monitor_events    — the monitor's own signal/breach/recovery history (its incidents
--                       live in prod_incidents; current_incident_id links the open one).
--
-- Idempotent: CREATE ... IF NOT EXISTS. tenant + segment scoped via the shared
-- set_default_segment_id() trigger (segment_id trigger-filled, as in 0236).

CREATE TABLE IF NOT EXISTS monitoring_boards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  name         VARCHAR(255) NOT NULL,
  image_key    VARCHAR(512),   -- R2 key from /api/brain/upload (null until uploaded)
  image_width  INTEGER,        -- natural px dimensions (for the overlay aspect ratio)
  image_height INTEGER,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monitoring_boards_tenant ON monitoring_boards(tenant_id);
DROP TRIGGER IF EXISTS trg_monitoring_boards_segment ON monitoring_boards;
CREATE TRIGGER trg_monitoring_boards_segment
  BEFORE INSERT ON monitoring_boards
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE TABLE IF NOT EXISTS monitors (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id           UUID REFERENCES segments(id) ON DELETE CASCADE,
  board_id             UUID NOT NULL REFERENCES monitoring_boards(id) ON DELETE CASCADE,
  project_id           INTEGER REFERENCES projects(id) ON DELETE SET NULL,  -- incident target project
  label                VARCHAR(255) NOT NULL,
  description          TEXT,
  pos_x                REAL NOT NULL DEFAULT 0.5,   -- 0..1 fraction of image width
  pos_y                REAL NOT NULL DEFAULT 0.5,   -- 0..1 fraction of image height
  monitor_type         VARCHAR(20) NOT NULL DEFAULT 'webhook', -- heartbeat|http_check|webhook|metric_threshold|manual
  config               JSONB NOT NULL DEFAULT '{}', -- { intervalSeconds, url, expectedStatus, metric, comparator, threshold, windowDays }
  affected_system      VARCHAR(120),
  severity             VARCHAR(16) NOT NULL DEFAULT 'sev3',   -- sev1..sev4 for the incident it opens
  escalation_policy_id UUID,                                  -- optional pin (else severity-matched policy)
  status               VARCHAR(16) NOT NULL DEFAULT 'unknown',-- ok | breached | unknown
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_signal_at       TIMESTAMP,   -- last heartbeat / ok signal received
  last_checked_at      TIMESTAMP,   -- last sweep evaluation
  last_status_change_at TIMESTAMP,
  current_incident_id  UUID,        -- the open incident this monitor spawned (null when ok)
  webhook_secret       VARCHAR(64), -- per-monitor token for the signal webhook
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP NOT NULL DEFAULT now(),
  updated_at           TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monitors_board ON monitors(board_id);
CREATE INDEX IF NOT EXISTS idx_monitors_tenant_status ON monitors(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_monitors_active ON monitors(active, monitor_type);
DROP TRIGGER IF EXISTS trg_monitors_segment ON monitors;
CREATE TRIGGER trg_monitors_segment
  BEFORE INSERT ON monitors
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE TABLE IF NOT EXISTS monitor_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  monitor_id  UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  kind        VARCHAR(16) NOT NULL DEFAULT 'signal',  -- signal | breach | recovery | check | error
  status      VARCHAR(16),                            -- ok | breached | unknown
  message     TEXT,
  incident_id UUID,                                   -- the incident opened (for kind='breach')
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monitor_events_monitor ON monitor_events(monitor_id, created_at);
