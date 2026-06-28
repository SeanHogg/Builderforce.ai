-- 0252_dashboard_pins.sql
-- Pinnable widget dashboard.
--
-- Two additions that turn the custom-dashboard tables into the unified, pinnable
-- widget dashboard:
--   1. dashboard_widgets can now reference a REGISTRY widget (a rich chart/stat
--      contributed by any surface) via `widget_key`, not only a scalar
--      `metric_key`. metric_key is therefore nullable (registry widgets carry no
--      server metric — they render client-side and gate themselves).
--   2. dashboard_pins records a USER's personal pins (the registry widget ids on
--      their /insights home dashboard), scoped to (tenant, user).
--
-- Idempotent / re-runnable.

-- ── Registry-backed widgets in a saved (tenant-shared) dashboard ──────────────
ALTER TABLE dashboard_widgets ADD COLUMN IF NOT EXISTS widget_key VARCHAR(96);
ALTER TABLE dashboard_widgets ALTER COLUMN metric_key DROP NOT NULL;

-- ── Per-user widget pins (the personal home dashboard) ────────────────────────
CREATE TABLE IF NOT EXISTS dashboard_pins (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     VARCHAR(36) NOT NULL,            -- the owning member
  widget_key  VARCHAR(96) NOT NULL,            -- registry widget id
  position    INTEGER NOT NULL DEFAULT 0,
  pinned_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, widget_key)
);
CREATE INDEX IF NOT EXISTS idx_dashboard_pins_tenant_user ON dashboard_pins(tenant_id, user_id);
