-- 0118_member_metrics_dora.sql
-- Two tables that turn the transition log (0117) + git activity (activity_events)
-- into the metrics the user asked for:
--
--   member_metrics_period — one effectiveness/engagement scorecard per member per
--     period. Parallels team_velocity (0060) but at member grain and covers humans
--     AND agents with one shape. The engagement_* columns are the human-only
--     dimensions (board hygiene, pickup latency, idle-after-done); throughput /
--     redo / reopen / cycle-time apply to everyone. Periodically (re)computed —
--     cached read-through on serve, recomputed on demand.
--
--   deployment_events — the missing DORA signal. Lead time / PR cycle time already
--     live on activity_events; deployment frequency, change-failure rate, and MTTR
--     need a deploy/restore stream. Each row is one deploy (optionally tied to the
--     task it shipped); is_failure + restored_at give change-failure-rate and MTTR.
--
-- Idempotent / re-runnable: CREATE TYPE guarded, tables IF NOT EXISTS.

-- ── member_metrics_period ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS member_metrics_period (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  member_kind   team_member_kind NOT NULL,
  member_ref    VARCHAR(64) NOT NULL,
  member_name   VARCHAR(255) NOT NULL,        -- denormalized for display (refreshed on compute)
  period_start  TIMESTAMP NOT NULL,
  period_end    TIMESTAMP NOT NULL,

  -- throughput / quality (BOTH populations)
  assigned_count   INTEGER NOT NULL DEFAULT 0,
  completed_count  INTEGER NOT NULL DEFAULT 0,
  redo_count       INTEGER NOT NULL DEFAULT 0,    -- backward transitions on this member's tasks (multiple iterations)
  reopen_count     INTEGER NOT NULL DEFAULT 0,    -- tasks bounced back OUT of a done lane
  avg_cycle_time_hours        REAL,               -- first in_progress → done

  -- engagement (HUMAN-specific board behaviour; null/0 for agents)
  avg_pickup_latency_hours    REAL,               -- assigned → first in_progress (uses response_sla_hours)
  avg_idle_after_done_hours   REAL,               -- last_worked_at → moved into done lane (did they keep the board honest)
  board_hygiene_score         REAL,               -- 0..100 from idle-after-done
  engagement_score            REAL,               -- 0..100 composite of pickup + hygiene + idle
  effectiveness_score         REAL,               -- 0..100 composite of throughput + redo + reopen + cycle time

  computed_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_member_metrics_period UNIQUE (tenant_id, member_kind, member_ref, period_start, period_end)
);

DROP TRIGGER IF EXISTS trg_member_metrics_period_segment ON member_metrics_period;
CREATE TRIGGER trg_member_metrics_period_segment BEFORE INSERT ON member_metrics_period FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE member_metrics_period x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE member_metrics_period ALTER COLUMN segment_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mmp_tenant ON member_metrics_period(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mmp_member ON member_metrics_period(member_kind, member_ref);

-- ── deployment_events (DORA: frequency, change-failure-rate, MTTR) ───────────
DO $$ BEGIN
  CREATE TYPE deployment_status AS ENUM ('success', 'failed', 'rolled_back');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS deployment_events (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  task_id       INTEGER REFERENCES tasks(id) ON DELETE SET NULL,  -- ticket this deploy shipped (lead-time bridge)
  environment   VARCHAR(64) NOT NULL DEFAULT 'production',
  status        deployment_status NOT NULL DEFAULT 'success',
  is_failure    BOOLEAN NOT NULL DEFAULT FALSE,   -- counts toward change-failure-rate
  external_ref  VARCHAR(255),                     -- deploy id / release tag / run url
  deployed_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  restored_at   TIMESTAMP,                        -- when a failed deploy was remediated (MTTR = restored_at - deployed_at)
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_deployment_events_segment ON deployment_events;
CREATE TRIGGER trg_deployment_events_segment BEFORE INSERT ON deployment_events FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE deployment_events x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE deployment_events ALTER COLUMN segment_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deploy_tenant  ON deployment_events(tenant_id, deployed_at);
CREATE INDEX IF NOT EXISTS idx_deploy_project ON deployment_events(project_id, deployed_at);
