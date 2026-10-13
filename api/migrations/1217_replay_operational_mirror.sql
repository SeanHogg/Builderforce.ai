-- 1217 · Insights (session replay) telemetry — the CORE MIRROR of
-- transactional-migrations/0015_replay.sql.
--
-- The operational tables live on NEON_TRANSACTIONAL_DATABASE_URL. Where that URL is
-- unbound (local, tests, a staged rollout) `siblingDatabase(env, db, 'operational')`
-- resolves to core, "where its tables also exist" (connection.ts) — so they are
-- created here too, with the identical DDL. In production the core copies stay empty:
-- every writer and reader resolves the operational handle first.
--
-- KEEP THE TWO FILES IN STEP. A column added to one is added to the other in the same
-- change (the `llm_usage_log` lesson: two migration tracks, one table).

CREATE TABLE IF NOT EXISTS replay_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  tenant_id integer NOT NULL,
  visitor_id varchar(64) NOT NULL,
  visit_id varchar(64) NOT NULL,
  started_at timestamp NOT NULL,
  last_event_at timestamp NOT NULL,
  ended_at timestamp,
  duration_ms integer NOT NULL DEFAULT 0,
  active_ms integer NOT NULL DEFAULT 0,
  entry_path varchar(400) NOT NULL DEFAULT '',
  exit_path varchar(400) NOT NULL DEFAULT '',
  page_count integer NOT NULL DEFAULT 0,
  release_key varchar(64) NOT NULL DEFAULT '',
  recorder_version varchar(32) NOT NULL DEFAULT '',
  device_class varchar(16) NOT NULL,
  viewport_w integer NOT NULL DEFAULT 0,
  viewport_h integer NOT NULL DEFAULT 0,
  browser varchar(32),
  os varchar(32),
  country varchar(2),
  referrer_host varchar(200),
  click_count integer NOT NULL DEFAULT 0,
  rage_count integer NOT NULL DEFAULT 0,
  dead_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  quickback_count integer NOT NULL DEFAULT 0,
  excessive_scroll_count integer NOT NULL DEFAULT 0,
  converted boolean NOT NULL DEFAULT false,
  keep_reason varchar(16) NOT NULL,
  sample_weight real NOT NULL DEFAULT 1,
  variant varchar(64),
  identified_id varchar(128),
  traits jsonb,
  billable_units integer NOT NULL DEFAULT 0,
  chunk_count integer NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0,
  routes text[] NOT NULL DEFAULT '{}'::text[],
  events text[] NOT NULL DEFAULT '{}'::text[],
  frustrations text[] NOT NULL DEFAULT '{}'::text[],
  clicked text[] NOT NULL DEFAULT '{}'::text[],
  issue_fps text[] NOT NULL DEFAULT '{}'::text[],
  steps text[] NOT NULL DEFAULT '{}'::text[],
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_recordings_visit ON replay_recordings (site_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_replay_recordings_site_started ON replay_recordings (site_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_replay_recordings_site_release ON replay_recordings (site_id, release_key);
CREATE INDEX IF NOT EXISTS idx_replay_recordings_visitor ON replay_recordings (visitor_id);
CREATE INDEX IF NOT EXISTS idx_replay_recordings_started ON replay_recordings (started_at);
CREATE INDEX IF NOT EXISTS idx_replay_recordings_routes ON replay_recordings USING gin (routes);
CREATE INDEX IF NOT EXISTS idx_replay_recordings_events ON replay_recordings USING gin (events);
CREATE INDEX IF NOT EXISTS idx_replay_recordings_frustrations ON replay_recordings USING gin (frustrations);
CREATE INDEX IF NOT EXISTS idx_replay_recordings_issue_fps ON replay_recordings USING gin (issue_fps);

CREATE TABLE IF NOT EXISTS replay_releases (
  site_id uuid NOT NULL,
  tenant_id integer NOT NULL,
  release_key varchar(64) NOT NULL,
  label varchar(80),
  source varchar(16) NOT NULL DEFAULT 'explicit',
  first_seen_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, release_key)
);

CREATE TABLE IF NOT EXISTS replay_route_daily (
  site_id uuid NOT NULL,
  tenant_id integer NOT NULL,
  day date NOT NULL,
  release_key varchar(64) NOT NULL,
  route varchar(200) NOT NULL,
  device_class varchar(16) NOT NULL,
  sessions integer NOT NULL DEFAULT 0,
  entries integer NOT NULL DEFAULT 0,
  exits integer NOT NULL DEFAULT 0,
  pageviews integer NOT NULL DEFAULT 0,
  new_visitors integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  frustrated integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  active_ms_sum bigint NOT NULL DEFAULT 0,
  scroll_depth_sum integer NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, day, release_key, route, device_class)
);
CREATE INDEX IF NOT EXISTS idx_replay_route_daily_day ON replay_route_daily (day);

CREATE TABLE IF NOT EXISTS replay_breakdown_daily (
  site_id uuid NOT NULL,
  tenant_id integer NOT NULL,
  day date NOT NULL,
  dim varchar(16) NOT NULL,
  value varchar(200) NOT NULL,
  sessions integer NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, day, dim, value)
);
CREATE INDEX IF NOT EXISTS idx_replay_breakdown_daily_day ON replay_breakdown_daily (day);

CREATE TABLE IF NOT EXISTS replay_heat_daily (
  site_id uuid NOT NULL,
  tenant_id integer NOT NULL,
  day date NOT NULL,
  release_key varchar(64) NOT NULL,
  route varchar(200) NOT NULL,
  device_class varchar(16) NOT NULL,
  kind varchar(16) NOT NULL,
  selector varchar(200) NOT NULL,
  label varchar(80) NOT NULL,
  gx smallint NOT NULL,
  gy smallint NOT NULL,
  n integer NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, day, release_key, route, device_class, kind, selector, label, gx, gy)
);
CREATE INDEX IF NOT EXISTS idx_replay_heat_daily_day ON replay_heat_daily (day);

CREATE TABLE IF NOT EXISTS replay_vitals_daily (
  site_id uuid NOT NULL,
  tenant_id integer NOT NULL,
  day date NOT NULL,
  release_key varchar(64) NOT NULL,
  route varchar(200) NOT NULL,
  device_class varchar(16) NOT NULL,
  metric varchar(8) NOT NULL,
  bucket smallint NOT NULL,
  n integer NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, day, release_key, route, device_class, metric, bucket)
);
CREATE INDEX IF NOT EXISTS idx_replay_vitals_daily_day ON replay_vitals_daily (day);

CREATE TABLE IF NOT EXISTS replay_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  tenant_id integer NOT NULL,
  fingerprint varchar(32) NOT NULL,
  kind varchar(24) NOT NULL,
  route varchar(200) NOT NULL,
  subject varchar(400) NOT NULL,
  title varchar(240) NOT NULL,
  first_release varchar(64),
  last_release varchar(64),
  first_seen_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now(),
  status varchar(16) NOT NULL DEFAULT 'new',
  prescription_id uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_issues_fingerprint ON replay_issues (site_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_replay_issues_site_seen ON replay_issues (tenant_id, site_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS replay_issue_daily (
  issue_id uuid NOT NULL REFERENCES replay_issues(id) ON DELETE CASCADE,
  day date NOT NULL,
  release_key varchar(64) NOT NULL,
  device_class varchar(16) NOT NULL,
  sessions integer NOT NULL DEFAULT 0,
  PRIMARY KEY (issue_id, day, release_key, device_class)
);
CREATE INDEX IF NOT EXISTS idx_replay_issue_daily_day ON replay_issue_daily (day);

CREATE TABLE IF NOT EXISTS replay_issue_representatives (
  issue_id uuid NOT NULL REFERENCES replay_issues(id) ON DELETE CASCADE,
  rank smallint NOT NULL,
  recording_id uuid NOT NULL REFERENCES replay_recordings(id) ON DELETE CASCADE,
  share real NOT NULL DEFAULT 0,
  label varchar(120),
  PRIMARY KEY (issue_id, rank)
);
CREATE INDEX IF NOT EXISTS idx_replay_issue_representatives_recording ON replay_issue_representatives (recording_id);

CREATE TABLE IF NOT EXISTS replay_visit_summaries (
  recording_id uuid PRIMARY KEY REFERENCES replay_recordings(id) ON DELETE CASCADE,
  summary text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  model varchar(120),
  generated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS replay_live (
  site_id uuid NOT NULL,
  tenant_id integer NOT NULL,
  visit_id varchar(64) NOT NULL,
  last_seen_at timestamp NOT NULL DEFAULT now(),
  route varchar(200) NOT NULL DEFAULT '',
  device_class varchar(16) NOT NULL,
  x smallint,
  y smallint,
  recording_id uuid,
  PRIMARY KEY (site_id, visit_id)
);
CREATE INDEX IF NOT EXISTS idx_replay_live_site_seen ON replay_live (site_id, last_seen_at DESC);

-- Retention-swept members (application/maintenance/sweptTables.ts) carry the tuning
-- `check:swept-tables` requires. The rollups and live presence are UPDATE-heavy
-- (additive upserts), so they also reserve page space for HOT updates.
ALTER TABLE replay_recordings SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                   autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000,
                                   fillfactor = 85);
ALTER TABLE replay_route_daily SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02,
                                    fillfactor = 80);
ALTER TABLE replay_breakdown_daily SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02,
                                        fillfactor = 80);
ALTER TABLE replay_heat_daily SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02,
                                   fillfactor = 80);
ALTER TABLE replay_vitals_daily SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02,
                                     fillfactor = 80);
ALTER TABLE replay_issues SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02,
                               fillfactor = 85);
ALTER TABLE replay_issue_daily SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02,
                                    fillfactor = 80);
ALTER TABLE replay_live SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 200,
                             autovacuum_analyze_scale_factor = 0.02, fillfactor = 70);
