-- 1216 · Insights (session replay) — the DEFINITIONS people edit (PRD 33 §3.2).
--
-- Core holds what a person writes and reads back: the site itself, saved segments,
-- smart-event rules, funnels, prescriptions and page captures. Everything written
-- per visitor (recordings, daily rollups, issues, live presence) lives on the
-- operational endpoint — transactional-migrations/0015, mirrored onto core by 1217
-- for environments where the operational URL is unbound.
--
-- Every child table hangs off `replay_sites` by a NOT NULL, ON DELETE CASCADE key, so
-- it inherits the site's tenant (check-tenant-column derives that) and disappears with
-- the site. `project_id` is a bare id: the hosted site's project row is resolved
-- through the apps database, never joined.
--
-- `replay_visits` (0486) is dropped: it sat on the wrong track with a nullable tenant
-- and its only reader — the superadmin `GET /api/admin/replay-visits` — is retired in
-- the same change (D17: no superadmin data path).

CREATE TABLE IF NOT EXISTS replay_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL,
  project_id integer,
  label varchar(200) NOT NULL DEFAULT '',
  api_key_id uuid REFERENCES tenant_api_keys(id) ON DELETE SET NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_sites_project
  ON replay_sites (tenant_id, project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_sites_api_key
  ON replay_sites (api_key_id) WHERE api_key_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_replay_sites_tenant ON replay_sites (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS replay_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES replay_sites(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  filter jsonb NOT NULL DEFAULT '{"all":[]}'::jsonb,
  created_by varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_segments_name ON replay_segments (site_id, name);

CREATE TABLE IF NOT EXISTS replay_smart_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES replay_sites(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  rule_kind varchar(16) NOT NULL,
  match varchar(400) NOT NULL,
  match_mode varchar(16) NOT NULL DEFAULT 'equals',
  created_by varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_smart_events_name ON replay_smart_events (site_id, name);

CREATE TABLE IF NOT EXISTS replay_funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES replay_sites(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  window_minutes integer NOT NULL DEFAULT 30,
  created_by varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_replay_funnels_site ON replay_funnels (site_id, created_at);

CREATE TABLE IF NOT EXISTS replay_funnel_steps (
  funnel_id uuid NOT NULL REFERENCES replay_funnels(id) ON DELETE CASCADE,
  ord smallint NOT NULL,
  step_kind varchar(16) NOT NULL,
  match varchar(400) NOT NULL,
  match_mode varchar(16) NOT NULL DEFAULT 'equals',
  PRIMARY KEY (funnel_id, ord)
);

CREATE TABLE IF NOT EXISTS replay_page_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES replay_sites(id) ON DELETE CASCADE,
  path varchar(400) NOT NULL,
  release_key varchar(64) NOT NULL DEFAULT '',
  device_class varchar(16) NOT NULL,
  captured_at timestamp NOT NULL DEFAULT now(),
  screenshot_key text,
  fold_screenshot_key text,
  rect_map_key text,
  seo jsonb,
  content jsonb,
  lab_perf jsonb,
  a11y jsonb,
  score jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_page_captures_grain
  ON replay_page_captures (site_id, path, release_key, device_class);

CREATE TABLE IF NOT EXISTS replay_prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES replay_sites(id) ON DELETE CASCADE,
  rule_id varchar(48) NOT NULL,
  area varchar(16) NOT NULL,
  source varchar(16) NOT NULL DEFAULT 'rule',
  subject_key varchar(400) NOT NULL,
  page_path varchar(400),
  capture_id uuid REFERENCES replay_page_captures(id) ON DELETE SET NULL,
  status varchar(16) NOT NULL DEFAULT 'proposed',
  finding jsonb NOT NULL DEFAULT '{}'::jsonb,
  prescription text,
  change jsonb,
  visual jsonb,
  impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_kind varchar(24),
  action_ref varchar(120),
  acceptance jsonb,
  measured jsonb,
  dismiss_reason text,
  decided_by varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
-- One open prescription per (site, rule, subject); a terminal one may be followed by a
-- fresh proposal once the suppression window passes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_prescriptions_open
  ON replay_prescriptions (site_id, rule_id, subject_key)
  WHERE status NOT IN ('worked', 'no_effect', 'worse', 'dismissed');
CREATE INDEX IF NOT EXISTS idx_replay_prescriptions_site ON replay_prescriptions (site_id, status, updated_at);

-- S4d: a proof's measure (`ProofMeasure`), persisted beside the realization it grades.
ALTER TABLE realizations ADD COLUMN IF NOT EXISTS measure jsonb;

DROP TABLE IF EXISTS replay_visits;
