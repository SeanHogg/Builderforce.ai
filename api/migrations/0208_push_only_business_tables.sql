-- Migration: create the remaining `drizzle-kit push`-only tables.
--
-- Each table below is declared in schema.ts and queried at runtime, but was only
-- ever materialised by the early `drizzle-kit push` baseline — no tracked
-- migration created it. A migration-only environment (e.g. production applying
-- api/migrations/*.sql against an empty DB) therefore never gets these tables
-- and crashes with "relation does not exist" the moment they are queried — the
-- identical drift class closed for telemetry_spans (0073) and agents /
-- approval_rules (0123). This converges every environment.
--
-- Same template as 0123: enum types guarded with a duplicate_object catch,
-- CREATE TABLE IF NOT EXISTS for idempotency over the push baseline. None of
-- these tables carry a segment_id column (they are not segment-scoped), so no
-- 0056 trigger replay is needed.
--
-- FK parents (users, tenants, agents, agent_hosts) are themselves push-baseline
-- tables that exist in every target DB; the references mirror the schema.ts model.

-- ── enum types referenced below (also push-baseline-created) ────────────────
DO $$ BEGIN
  CREATE TYPE tenant_role AS ENUM ('owner', 'manager', 'developer', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE managed_agent_host_request_status AS ENUM ('pending', 'provisioning', 'active', 'cancelled', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE audit_event_type AS ENUM (
    'user_registered', 'user_login',
    'task_submitted', 'task_cancelled',
    'execution_started', 'execution_completed', 'execution_failed',
    'agent_registered',
    'member_added', 'member_removed',
    'project_created', 'project_updated',
    'task_created', 'task_updated'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── marketplace_skill_likes ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_skill_likes (
  user_id    VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_slug VARCHAR(255) NOT NULL,
  PRIMARY KEY (user_id, skill_slug)
);

-- ── tenant_members ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_members (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       tenant_role NOT NULL DEFAULT 'developer',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── managed_agent_host_requests ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS managed_agent_host_requests (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status          managed_agent_host_request_status NOT NULL DEFAULT 'pending',
  agent_host_name VARCHAR(255) NOT NULL,
  region          VARCHAR(100) NOT NULL DEFAULT 'us-east',
  notes           TEXT,
  provisioned_at  TIMESTAMP,
  agent_host_id   INTEGER,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── skills ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id            SERIAL PRIMARY KEY,
  agent_id      INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  input_schema  TEXT,
  output_schema TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── audit_events ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_events (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER REFERENCES tenants(id),
  user_id       VARCHAR(36),
  event_type    audit_event_type NOT NULL,
  resource_type VARCHAR(100),
  resource_id   VARCHAR(100),
  metadata      TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── tenant_skill_assignments ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_skill_assignments (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  skill_slug  VARCHAR(255) NOT NULL,
  assigned_by VARCHAR(36) REFERENCES users(id),
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tenant_skill_assignment UNIQUE (tenant_id, skill_slug)
);

-- ── agent_host_skill_assignments ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_host_skill_assignments (
  id            SERIAL PRIMARY KEY,
  agent_host_id INTEGER NOT NULL REFERENCES agent_hosts(id) ON DELETE CASCADE,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  skill_slug    VARCHAR(255) NOT NULL,
  assigned_by   VARCHAR(36) REFERENCES users(id),
  assigned_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_agent_host_skill_assignment UNIQUE (agent_host_id, skill_slug)
);
