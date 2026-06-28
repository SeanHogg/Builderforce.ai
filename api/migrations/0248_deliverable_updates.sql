-- 0248_deliverable_updates.sql
-- EMP-11: a human-authored qualitative UPDATE stream attached to any deliverable
-- (initiative | project | release | sprint). PMO entities had description/status
-- but no timeline of manager/PM context ("blocked on infra", "scope cut agreed");
-- audit events are machine-generated. This is the narrative companion to the
-- delivery lens's quantitative status. tenant+segment scoped. Idempotent.

CREATE TABLE IF NOT EXISTS deliverable_updates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  -- Polymorphic target: which deliverable this update is about.
  scope_kind   VARCHAR(16) NOT NULL,                    -- initiative | project | release | sprint
  scope_id     VARCHAR(64) NOT NULL,                    -- uuid (initiative/release/sprint) or int id (project), as text
  -- A status the author is asserting alongside the note (optional, free of the
  -- machine status): on_track | at_risk | blocked | done | note.
  status_label VARCHAR(16),
  body         TEXT NOT NULL,
  author_id    VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  author_name  VARCHAR(255),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deliverable_updates_scope
  ON deliverable_updates(tenant_id, scope_kind, scope_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_deliverable_updates_segment ON deliverable_updates;
CREATE TRIGGER trg_deliverable_updates_segment
  BEFORE INSERT ON deliverable_updates
  FOR EACH ROW
  EXECUTE FUNCTION set_default_segment_id();
