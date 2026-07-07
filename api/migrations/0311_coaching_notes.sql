-- 0311_coaching_notes.sql
-- EMP-16 — the write-half of high/low-performer flagging + coaching. A manager's
-- free-form coaching note attached to a workforce member (human OR agent). The
-- performer-tier read (application/metrics/performerTiers.ts) is derived live from
-- the effectiveness/engagement scorecard; this table persists the human follow-up
-- (the coaching action a manager records against a member on the watch list).
--
-- Member identity is the polymorphic (member_kind, member_ref) convention shared by
-- member_profiles / member_metrics_period / task_status_transitions. No FK on
-- member_ref (the three target tables are heterogeneous) — referential integrity is
-- enforced in the route, exactly as member_profiles (0116) does.
--
-- Idempotent / re-runnable: table IF NOT EXISTS, guarded trigger.

CREATE TABLE IF NOT EXISTS coaching_notes (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  member_kind  VARCHAR(16) NOT NULL,           -- human | cloud_agent | host_agent
  member_ref   VARCHAR(64) NOT NULL,           -- users.id | ide_agents.id | agent_hosts.id
  note         TEXT NOT NULL,
  author_id    VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,  -- manager who wrote it
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_coaching_notes_segment ON coaching_notes;
CREATE TRIGGER trg_coaching_notes_segment BEFORE INSERT ON coaching_notes FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE coaching_notes x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE coaching_notes ALTER COLUMN segment_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coaching_notes_tenant ON coaching_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_coaching_notes_member ON coaching_notes(tenant_id, member_kind, member_ref);
