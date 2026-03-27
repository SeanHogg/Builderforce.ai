-- Migration: Admin impersonation sessions, audit log, and session version
-- Phase 1 & 2 of PRD: Super Admin Impersonation & Permission Management

-- ---------------------------------------------------------------------------
-- 1. session_version on users — fast token invalidation without a blocklist
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. admin_impersonation_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_impersonation_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id       varchar(36) NOT NULL REFERENCES users(id),
  target_user_id      varchar(36) NOT NULL REFERENCES users(id),
  tenant_id           integer     NOT NULL REFERENCES tenants(id),
  role_override       varchar(64) NOT NULL,
  reason              text        NOT NULL,
  token_jti           varchar(256) UNIQUE,
  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,
  expires_at          timestamptz NOT NULL,
  end_reason          varchar(32),          -- MANUAL | EXPIRED | ADMIN_LOGOUT
  pages_visited       jsonb       NOT NULL DEFAULT '[]',
  write_block_count   integer     NOT NULL DEFAULT 0,
  ip_address          varchar(64),
  user_agent          text,
  debugger_enabled    boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ais_admin_user   ON admin_impersonation_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_ais_target_user  ON admin_impersonation_sessions(target_user_id);
CREATE INDEX IF NOT EXISTS idx_ais_active       ON admin_impersonation_sessions(admin_user_id) WHERE ended_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. admin_impersonation_role_switches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_impersonation_role_switches (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES admin_impersonation_sessions(id),
  from_role   varchar(64) NOT NULL,
  to_role     varchar(64) NOT NULL,
  switched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_airs_session ON admin_impersonation_role_switches(session_id);

-- ---------------------------------------------------------------------------
-- 4. admin_audit_log — append-only; no UPDATE or DELETE via app layer
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event           varchar(64) NOT NULL,
  actor_id        varchar(36) REFERENCES users(id),
  target_user_id  varchar(36) REFERENCES users(id),
  tenant_id       integer     REFERENCES tenants(id),
  metadata        jsonb       NOT NULL DEFAULT '{}',
  ip_address      varchar(64),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aal_event      ON admin_audit_log(event);
CREATE INDEX IF NOT EXISTS idx_aal_actor      ON admin_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_aal_target     ON admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_aal_created_at ON admin_audit_log(created_at DESC);
