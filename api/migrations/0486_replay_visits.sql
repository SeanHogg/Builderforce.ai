-- Session-replay visit summaries (PRD 33 S4).
--
-- One row per recording. Counters and paths are the foldVisit() result
-- (domain/replay/visitSummary.ts); the ingest that WRITES this table is a
-- later slice. The superadmin Sessions canvas reads it via
-- GET /api/admin/replay-visits on the primary database (requestDb).
--
-- site_id is an opaque recorder key, not project_sites.id — that parent is a
-- serial integer, and replay_sites does not exist yet. tenant_id is nullable:
-- a visit can land before the visitor has an account.

CREATE TABLE IF NOT EXISTS replay_visits (
  visit_id varchar(64) PRIMARY KEY,
  site_id varchar(64) NOT NULL,
  tenant_id integer REFERENCES tenants(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  last_event_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_ms integer NOT NULL DEFAULT 0,
  active_ms integer NOT NULL DEFAULT 0,
  entry_path varchar(512) NOT NULL DEFAULT '',
  exit_path varchar(512) NOT NULL DEFAULT '',
  page_count integer NOT NULL DEFAULT 0,
  click_count integer NOT NULL DEFAULT 0,
  rage_count integer NOT NULL DEFAULT 0,
  dead_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  quickback_count integer NOT NULL DEFAULT 0,
  excessive_scroll_count integer NOT NULL DEFAULT 0,
  converted boolean NOT NULL DEFAULT false,
  chunk_count integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_replay_visits_site_last
  ON replay_visits (site_id, last_event_at DESC);

CREATE INDEX IF NOT EXISTS idx_replay_visits_site_started
  ON replay_visits (site_id, started_at DESC);
