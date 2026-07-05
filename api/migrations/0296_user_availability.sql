-- 0293_user_availability.sql
-- Per-user bookable availability windows (working hours) that back "find a time"
-- and the calendar's free/busy shading. One row per (tenant, user).
--
--   windows = JSON array of weekly recurring windows, each
--             { "day": 0-6 (0=Sun), "start": <minutes-from-midnight>, "end": <minutes> }
--             interpreted in the row's `timezone` (IANA, e.g. "America/New_York").
--
-- A user with NO row is treated as "available anytime" (no declared constraints),
-- so booking still works before anyone sets hours. Idempotent.

CREATE TABLE IF NOT EXISTS user_availability (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     VARCHAR(64) NOT NULL,                 -- users.id
  timezone    VARCHAR(64) NOT NULL DEFAULT 'UTC',   -- IANA tz the windows are expressed in
  windows     JSONB NOT NULL DEFAULT '[]',          -- [{day,start,end}] weekly recurring
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One availability profile per (user, tenant) — upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_availability_user
  ON user_availability(tenant_id, user_id);
