-- 0247_time_entries.sql
-- Real per-task time logging — replaces the cycle-time ESTIMATE the planning
-- spine used for labour cost (closes SPINE-1). A member logs minutes against a
-- task on a given day; the spine sums logged minutes × the member's cost rate for
-- authoritative human cost, and the member activity chart buckets logged hours by
-- day. Member is polymorphic (human | cloud_agent | host_agent) keyed by ref, the
-- same identity the workforce metrics use.

CREATE TABLE IF NOT EXISTS time_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  uuid REFERENCES segments(id) ON DELETE CASCADE,
  task_id     integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  member_kind varchar(16) NOT NULL,             -- human | cloud_agent | host_agent
  member_ref  varchar(64) NOT NULL,             -- users.id | agent_hosts.id | cloud ref
  minutes     integer NOT NULL,                 -- logged minutes (>0)
  entry_date  date NOT NULL,                     -- the day worked (activity-chart bucket)
  source      varchar(12) NOT NULL DEFAULT 'manual', -- manual | timer | derived
  note        text,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_member
  ON time_entries(tenant_id, member_kind, member_ref, entry_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_segment ON time_entries(tenant_id, segment_id);

-- Default segment_id from the tenant when an insert omits it (same guard the other
-- planning trackers use).
DROP TRIGGER IF EXISTS trg_time_entries_segment ON time_entries;
CREATE TRIGGER trg_time_entries_segment
  BEFORE INSERT ON time_entries
  FOR EACH ROW
  EXECUTE FUNCTION set_default_segment_id();
