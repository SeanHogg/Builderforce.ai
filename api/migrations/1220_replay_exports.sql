-- 1220 · Insights MP4 export jobs (PRD 33 D10, §8 S4b).
--
-- One row per requested render of a kept recording. The QA runner container renders
-- the replay headlessly (job kind `replay_export`, no new queue or container) and
-- reports back through the export's own capability token; the file lands in R2 at
-- `r2_key` (`replay-exports/t<tenant>/<export>.<ext>`). `recording_id` is a plain id:
-- recordings live on the operational endpoint (transactional-migrations/0015).
--
-- `status`: queued | running | done | failed | unavailable (no runner provisioned —
-- nothing is charged). Rows and their files are purged after seven days by the daily
-- Insights retention pass.

CREATE TABLE IF NOT EXISTS replay_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES replay_sites(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'queued',
  format varchar(8),
  r2_key text,
  error varchar(400),
  requested_by varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_replay_exports_recording
  ON replay_exports (tenant_id, site_id, recording_id, created_at);
CREATE INDEX IF NOT EXISTS idx_replay_exports_created ON replay_exports (created_at);
