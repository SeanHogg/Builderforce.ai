-- 0309_lens_snapshots.sql
-- Annual-calendar cadence — periodic point-in-time SNAPSHOTS of an insight lens
-- (monthly / quarterly / annual reviews). Rides the same scheduled-sweep pattern
-- as report_schedules/runDueReports: a cron consumer captures the lens payload for
-- the due period and stores it here so a "Q3 review" freezes exactly what the lens
-- showed at close, independent of later data drift.
--
--   lens    = which lens was captured (engineering | dora | finance | allocation |
--             compliance | portfolio | delivery) — free-text varchar so adding a
--             lens needs no type migration.
--   period  = the review window label: 'YYYY-MM' (monthly), 'YYYY-Qn' (quarterly),
--             or 'YYYY' (annual). The (lens, period) pair is the idempotent key —
--             re-capturing a period overwrites its payload.
--   payload = the computed lens JSON, frozen at generated_at.
--
-- Idempotent / re-runnable.

CREATE TABLE IF NOT EXISTS lens_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  lens          VARCHAR(32) NOT NULL,
  period        VARCHAR(16) NOT NULL,   -- 'YYYY-MM' | 'YYYY-Qn' | 'YYYY'
  payload       JSONB NOT NULL DEFAULT '{}',
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One snapshot per (tenant, lens, period) — the capture upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lens_snapshot
  ON lens_snapshots(tenant_id, lens, period);

CREATE INDEX IF NOT EXISTS idx_lens_snapshots_tenant ON lens_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lens_snapshots_lens   ON lens_snapshots(tenant_id, lens, generated_at DESC);

-- Segment default backfill + NOT NULL (matches report_schedules' segment seam).
DROP TRIGGER IF EXISTS trg_lens_snapshots_segment ON lens_snapshots;
CREATE TRIGGER trg_lens_snapshots_segment BEFORE INSERT ON lens_snapshots FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE lens_snapshots x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
