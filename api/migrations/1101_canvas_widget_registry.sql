-- 1101 — The third-party canvas widget registry.
--
-- ── WHAT A ROW IS ────────────────────────────────────────────────────────────
-- One registered widget: somebody else's page, which a board may embed in a
-- sandboxed frame and talk to over a fixed postMessage vocabulary. The manifest a
-- developer submits (`@builderforce/canvas-widget-protocol`) is stored here almost
-- verbatim, with ONE field the caller never supplies.
--
-- ── ENTRY_ORIGIN IS DERIVED, NEVER SUPPLIED ──────────────────────────────────
-- `entry_origin` is computed server-side from `entry_url` and is the ONLY origin
-- the browser host will accept a message from. It is a stored column rather than a
-- read-time `new URL(entry_url).origin` because it is a SECURITY predicate that
-- three different runtimes compare against, and a predicate recomputed in three
-- places is a predicate that will one day be computed differently in one of them.
-- Deriving it also removes the field a caller could otherwise lie about: a
-- manifest that declares its own trusted origin is a manifest that trusts itself.
--
-- ── WHY THERE IS NO PLACEMENT TABLE ──────────────────────────────────────────
-- A widget ON a board is a `creation_session_objects` row whose `resource_type` is
-- 'canvas_widget' and whose `resource_id` is this table's id — the canvas already
-- models "an object that points at a resource elsewhere", and that is exactly what
-- a placement is. A second table would duplicate placement, z-order, geometry,
-- locking and the revision protocol that the canvas graph already owns, and would
-- leave every export and preview path with two kinds of thing on a board.
--
-- ── WHY PERMISSIONS ARE A COLUMN AND NOT A JOIN TABLE ────────────────────────
-- The grant is small, closed and approved as a unit: an admin says yes to a
-- manifest, not to seven independent rows. `permissions` is the approved set, and
-- the host reads it — never what the frame claims about itself at runtime.

CREATE TABLE IF NOT EXISTS canvas_widgets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The REGISTERING workspace. A widget is tenant-owned: cross-workspace
  -- distribution is a marketplace listing (`catalog_items`), not a second
  -- ownership column here.
  tenant_id         integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Caller-chosen stable id, unique per workspace, so an integrator can upsert
  -- their own widget from CI without storing our uuid.
  widget_key        varchar(64) NOT NULL,
  name              varchar(120) NOT NULL,
  description       text,
  entry_url         text NOT NULL,
  -- Derived from entry_url. See the header — the message-origin check reads this.
  entry_origin      varchar(255) NOT NULL,
  icon_url          text,
  -- The APPROVED permission set, from CANVAS_WIDGET_PERMISSIONS.
  permissions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  version           varchar(32) NOT NULL DEFAULT '1.0.0',
  -- Default frame size in board units; a widget may ask to be resized at runtime.
  default_width     integer NOT NULL DEFAULT 480,
  default_height    integer NOT NULL DEFAULT 360,
  -- 'active' | 'disabled'. Disabling stops the host mounting the frame without
  -- deleting the registration, so a board that already placed it keeps the object
  -- and shows a disabled card instead of an empty rectangle.
  status            varchar(16) NOT NULL DEFAULT 'active',
  created_by_key_id uuid REFERENCES tenant_api_keys(id) ON DELETE SET NULL,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canvas_widgets_key
  ON canvas_widgets (tenant_id, widget_key);

CREATE INDEX IF NOT EXISTS idx_canvas_widgets_tenant_status
  ON canvas_widgets (tenant_id, status);
