-- Migration: create the Contributor / Team-analytics / Report / Team-memory
-- subsystem (schema sections 6b–6f + the cross-claw team-memory mesh).
--
-- ── Why this exists (schema-drift repair) ───────────────────────────────────
-- These tables were added to the Drizzle schema and wired into runtime routes
-- (analyticsRoutes, contributorRoutes, the P4-5 team-memory mesh) but their
-- CREATE TABLE migration was never authored — they were only ever brought into
-- existence locally via `drizzle-kit push`. Migration 0056 (segment_id
-- propagation) ALTERs them but guards every statement with to_regclass(), so in
-- any environment where push never ran the alters silently no-op'd. Migration
-- 0069 is the first to ALTER `contributors` WITHOUT a guard, which is why the
-- production deploy crashed with `relation "contributors" does not exist`.
--
-- This migration creates the cluster in its post-0056 / pre-0069 shape:
--   • segment_id column + default-fill trigger + NOT NULL (what 0056 would have
--     done had the tables existed), and
--   • WITHOUT contributors.kind / contributors.claw_id — those are added next by
--     0069 (ADD COLUMN IF NOT EXISTS), preserving the historical layering.
--
-- It must sort AFTER 0056 (the set_default_segment_id() trigger fn it relies on)
-- and BEFORE 0069 — hence the `0068a` filename. Every statement is idempotent
-- (CREATE TYPE guarded, CREATE TABLE IF NOT EXISTS, backfill before SET NOT
-- NULL) so it is safe to run in environments where push already created some or
-- all of these tables.

-- ── Enums used only by this subsystem (also never created until now) ─────────
DO $$ BEGIN
  CREATE TYPE activity_event_type AS ENUM (
    'commit', 'pr_opened', 'pr_merged', 'pr_closed', 'pr_reviewed',
    'issue_created', 'issue_resolved', 'issue_commented'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_type AS ENUM (
    'standup', 'code_review', 'project_status', 'executive_summary'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_schedule AS ENUM ('daily', 'weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 6b. Contributors (cross-platform unified profile) ───────────────────────
CREATE TABLE IF NOT EXISTS contributors (
  id                   SERIAL PRIMARY KEY,
  tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id           UUID REFERENCES segments(id) ON DELETE CASCADE,
  display_name         VARCHAR(255) NOT NULL,
  email                VARCHAR(255),
  avatar_url           VARCHAR(500),
  job_title            VARCHAR(255),
  role_type            VARCHAR(50) NOT NULL DEFAULT 'developer',
  exclude_from_metrics BOOLEAN NOT NULL DEFAULT FALSE,
  user_id              VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_contributors_segment ON contributors;
CREATE TRIGGER trg_contributors_segment BEFORE INSERT ON contributors FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE contributors x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE contributors ALTER COLUMN segment_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contributors_tenant  ON contributors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contributors_segment ON contributors(segment_id);

-- ── Cross-platform identity reconciliation ──────────────────────────────────
CREATE TABLE IF NOT EXISTS contributor_identities (
  id             SERIAL PRIMARY KEY,
  contributor_id INTEGER NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  provider       integration_provider NOT NULL,
  external_id    VARCHAR(255) NOT NULL,
  external_email VARCHAR(255),
  display_name   VARCHAR(255),
  avatar_url     VARCHAR(500),
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_identity_provider_external UNIQUE (tenant_id, provider, external_id)
);
DROP TRIGGER IF EXISTS trg_contributor_identities_segment ON contributor_identities;
CREATE TRIGGER trg_contributor_identities_segment BEFORE INSERT ON contributor_identities FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE contributor_identities x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE contributor_identities ALTER COLUMN segment_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contributor_identities_contributor ON contributor_identities(contributor_id);
CREATE INDEX IF NOT EXISTS idx_contributor_identities_segment     ON contributor_identities(segment_id);

-- ── 6c. Raw activity events (commits, PRs, reviews, issues) ─────────────────
CREATE TABLE IF NOT EXISTS activity_events (
  id                   SERIAL PRIMARY KEY,
  tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id           UUID REFERENCES segments(id) ON DELETE CASCADE,
  contributor_id       INTEGER REFERENCES contributors(id) ON DELETE SET NULL,
  credential_id        UUID REFERENCES integration_credentials(id) ON DELETE SET NULL,
  provider             integration_provider NOT NULL,
  event_type           activity_event_type NOT NULL,
  external_id          VARCHAR(255),
  repository_name      VARCHAR(255),
  repository_full_name VARCHAR(500),
  title                TEXT,
  url                  VARCHAR(500),
  lines_added          INTEGER,
  lines_removed        INTEGER,
  files_changed        INTEGER,
  cycle_time_hours     INTEGER,
  occurred_at          TIMESTAMP NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_activity_provider_external UNIQUE (tenant_id, provider, event_type, external_id)
);
DROP TRIGGER IF EXISTS trg_activity_events_segment ON activity_events;
CREATE TRIGGER trg_activity_events_segment BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE activity_events x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE activity_events ALTER COLUMN segment_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_events_contributor ON activity_events(contributor_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_occurred    ON activity_events(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_activity_events_segment     ON activity_events(segment_id);

-- ── 6d. Daily aggregated metrics per contributor ────────────────────────────
CREATE TABLE IF NOT EXISTS contributor_daily_metrics (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  contributor_id  INTEGER NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
  date            TIMESTAMP NOT NULL,
  commits         INTEGER NOT NULL DEFAULT 0,
  prs_opened      INTEGER NOT NULL DEFAULT 0,
  prs_merged      INTEGER NOT NULL DEFAULT 0,
  prs_reviewed    INTEGER NOT NULL DEFAULT 0,
  issues_created  INTEGER NOT NULL DEFAULT 0,
  issues_resolved INTEGER NOT NULL DEFAULT 0,
  lines_added     INTEGER NOT NULL DEFAULT 0,
  lines_removed   INTEGER NOT NULL DEFAULT 0,
  files_changed   INTEGER NOT NULL DEFAULT 0,
  activity_score  INTEGER NOT NULL DEFAULT 0,
  is_active_day   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_contributor_daily UNIQUE (tenant_id, contributor_id, date)
);
DROP TRIGGER IF EXISTS trg_contributor_daily_metrics_segment ON contributor_daily_metrics;
CREATE TRIGGER trg_contributor_daily_metrics_segment BEFORE INSERT ON contributor_daily_metrics FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE contributor_daily_metrics x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE contributor_daily_metrics ALTER COLUMN segment_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contributor_daily_metrics_segment ON contributor_daily_metrics(segment_id);

-- ── 6e. Team hierarchy ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dev_teams (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  description    TEXT,
  parent_team_id INTEGER,
  manager_id     INTEGER REFERENCES contributors(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_dev_teams_segment ON dev_teams;
CREATE TRIGGER trg_dev_teams_segment BEFORE INSERT ON dev_teams FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE dev_teams x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE dev_teams ALTER COLUMN segment_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dev_teams_segment ON dev_teams(segment_id);

CREATE TABLE IF NOT EXISTS dev_team_members (
  id             SERIAL PRIMARY KEY,
  team_id        INTEGER NOT NULL REFERENCES dev_teams(id) ON DELETE CASCADE,
  contributor_id INTEGER NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
  member_role    VARCHAR(50) NOT NULL DEFAULT 'member',
  joined_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_team_contributor UNIQUE (team_id, contributor_id)
);

-- ── 6f. Scheduled reports + subscriptions ───────────────────────────────────
CREATE TABLE IF NOT EXISTS report_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  report_type   report_type NOT NULL,
  schedule      report_schedule NOT NULL,
  delivery_hour INTEGER NOT NULL DEFAULT 8,
  recipients    TEXT NOT NULL DEFAULT '[]',
  is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at   TIMESTAMP,
  next_run_at   TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_report_schedules_segment ON report_schedules;
CREATE TRIGGER trg_report_schedules_segment BEFORE INSERT ON report_schedules FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE report_schedules x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE report_schedules ALTER COLUMN segment_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_report_schedules_segment ON report_schedules(segment_id);

CREATE TABLE IF NOT EXISTS report_subscriptions (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  user_id       VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_type   report_type NOT NULL,
  is_subscribed BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_subscription_user_type UNIQUE (tenant_id, user_id, report_type)
);
DROP TRIGGER IF EXISTS trg_report_subscriptions_segment ON report_subscriptions;
CREATE TRIGGER trg_report_subscriptions_segment BEFORE INSERT ON report_subscriptions FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE report_subscriptions x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE report_subscriptions ALTER COLUMN segment_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_report_subscriptions_segment ON report_subscriptions(segment_id);

-- ── Team memory — cross-claw memory sharing mesh (P4-5) ─────────────────────
CREATE TABLE IF NOT EXISTS team_memory (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  claw_id    VARCHAR(64) NOT NULL,
  run_id     VARCHAR(64) NOT NULL,
  summary    TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '[]',
  timestamp  VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_team_memory_segment ON team_memory;
CREATE TRIGGER trg_team_memory_segment BEFORE INSERT ON team_memory FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE team_memory x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE team_memory ALTER COLUMN segment_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_memory_tenant  ON team_memory(tenant_id, claw_id);
CREATE INDEX IF NOT EXISTS idx_team_memory_segment ON team_memory(segment_id);
