-- Stage Sandbox — real execution behind marketplace Stage checks.
--
-- One row per dispatched (or cap-refused) sandbox run. `payload_hash` is what the
-- publish gate matches on, deliberately NOT `snapshot_id`: a re-stage of an
-- unchanged board must reuse its clean run, and a one-byte edit must invalidate
-- it. See api/src/domain/marketplace/stageSandboxPayload.ts.
CREATE TABLE stage_sandbox_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_id    uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  listing_id     uuid REFERENCES catalog_items(id) ON DELETE SET NULL,
  payload_hash   varchar(64) NOT NULL,
  -- 'runtime' | 'media' — the only two harnesses a container can drive.
  harness        varchar(16) NOT NULL,
  -- 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'capped'.
  status         varchar(16) NOT NULL DEFAULT 'queued',
  findings       jsonb,
  summary        text,
  error_message  text,
  duration_ms    integer,
  created_by     varchar(36),
  started_at     timestamp,
  finished_at    timestamp,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);

-- The gate's read: "is there a terminal, hash-matching run for this tenant?"
CREATE INDEX idx_stage_sandbox_runs_lookup
  ON stage_sandbox_runs (tenant_id, payload_hash, created_at DESC);

-- The meter's read (mirrors outbound_fetch_log's shape).
CREATE INDEX idx_stage_sandbox_runs_meter
  ON stage_sandbox_runs (tenant_id, created_at);

-- Best-effort dedupe of two near-simultaneous Stage presses on the same build:
-- application code SELECTs an in-flight/clean row before inserting and only
-- inserts on a miss, so this exists as a backstop against the residual race
-- rather than as the primary mechanism (a partial-unique ON CONFLICT target
-- would require Drizzle to restate the predicate on every insert, which is
-- more fragile than catching the rare 23505 here does).
CREATE INDEX idx_stage_sandbox_runs_inflight
  ON stage_sandbox_runs (tenant_id, payload_hash)
  WHERE status IN ('queued', 'running');
