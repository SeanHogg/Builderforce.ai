-- 0373 — The AI Manager's SYSTEMIC findings: one row per (project, stall cause) cohort
-- the manager has concluded is a PLATFORM problem rather than N independent tickets.
--
-- WHY
--
-- The manager's stuck register (0367) is per-ticket, and its triage stage is bounded to
-- a dozen tickets per project per pass. Both are correct for ACTING on one ticket. But
-- the measured failure on tenant 1 (2026-07-26) was not a ticket problem at all: 313
-- tickets shared the single cause `unassigned` (no lane staffing anywhere), 149 shared
-- an unsatisfied sign-off round-trip, 116 sat behind the failure breaker. Those are
-- three configuration/platform defects wearing 578 ticket costumes, and remedying them
-- one ticket at a time is exactly the retry storm the register exists to stop.
--
-- So when a cohort crosses a materiality threshold the manager stops treating it as
-- ticket work, asks a model to name the root cause and the remediation, and files ONE
-- ticket for it. This table is what makes that idempotent: without it every five-minute
-- pass would file the same finding again, which would be a far worse write amplifier
-- than the `auto_run_skipped` storm already on the gap register.
--
-- `status` is the dedupe key together with (tenant, project, cause): at most ONE open
-- finding per cohort per project. The row is resolved when the cohort drops back under
-- the threshold, so a recurrence after a genuine fix legitimately files a fresh finding
-- rather than resurrecting a stale one.

CREATE TABLE IF NOT EXISTS manager_systemic_findings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The stall cause this cohort shares (application/manager/stallTriage.StallCause).
  cause           varchar(32) NOT NULL,
  -- How many tickets shared the cause when the finding was raised / last refreshed.
  ticket_count    integer NOT NULL DEFAULT 0,
  -- The model's root-cause statement and its proposed remediation.
  summary         text NOT NULL,
  remediation     text NOT NULL,
  -- Whether a model produced this, or the deterministic fallback did.
  source          varchar(16) NOT NULL DEFAULT 'ai',
  -- The platform-fix ticket this finding filed, when one was created.
  created_task_id integer REFERENCES tasks(id) ON DELETE SET NULL,
  status          varchar(16) NOT NULL DEFAULT 'open',
  first_seen_at   timestamp NOT NULL DEFAULT now(),
  last_seen_at    timestamp NOT NULL DEFAULT now(),
  resolved_at     timestamp,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

-- At most one OPEN finding per cohort per project — the idempotency guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_systemic_open
  ON manager_systemic_findings (tenant_id, project_id, cause)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_manager_systemic_lookup
  ON manager_systemic_findings (tenant_id, project_id, status, last_seen_at);
