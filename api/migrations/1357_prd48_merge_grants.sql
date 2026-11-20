-- 1357 · PRD 48 §4.6 — a person's "merge into main" grant for ONE cloud run (EXPAND only).
--
-- WHY. A security fix or a high-priority feature must not wait for the manager (operator,
-- 2026-11-19). A PERSON — with the role the in-product Merge button requires — may grant, when
-- dispatching a cloud run, that its pull request merges into the base branch once its checks
-- pass. The grant is a pre-approved human merge: it overrides the project's merge settings
-- (`allow_auto_merge` off, the manager off, canary) exactly as the in-product Merge button is
-- not bound by them, and it still requires a passing security verdict AND green CI.
--
-- One row per granted execution. The run never merges: the PR merge sweep (`prMergeSweep.ts`,
-- the single automatic merge writer) merges a granted PR through `mergeRecordedPr` and stamps
-- `consumed_at`. `granted_by` is the person (never a run or an agent); `reason` is required
-- and non-empty — the audit question is "who let this into main, and why".
--
-- THE GRANT IS BOUND TO THIS RUN'S PULL REQUEST, AT THIS RUN'S HEAD — never to the ticket.
-- `merge_grant_pull_requests` records the PR(s) the granted execution itself opened or adopted,
-- with the head commit its finalize saw. The sweep merges only a bound PR, pinned to that commit:
-- a later ungranted re-run's PR, or later commits pushed by anyone else, cannot ride on the grant.
-- A grant is VOIDED (`voided_at`, `void_reason`) when its run ends without a PR or is cancelled,
-- or when the bound PR's head moves past the pinned commit. `hold_code` is the sweep's CURRENT
-- reason for holding a bound PR (null = not held), so the run view never shows a stale hold.
--
-- EXPAND only: new tables. Safe as a single push.

SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS merge_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  execution_id  integer NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  granted_by    varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason        text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_at    timestamp NOT NULL DEFAULT now(),
  consumed_at   timestamp,
  voided_at     timestamp,
  void_reason   varchar(40)
);

-- The PR(s) the granted run opened, and the head commit its finalize saw — the merge is pinned to it.
CREATE TABLE IF NOT EXISTS merge_grant_pull_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grant_id         uuid NOT NULL REFERENCES merge_grants(id) ON DELETE CASCADE,
  pull_request_id  uuid NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  head_sha         varchar(64) NOT NULL,
  hold_code        varchar(40),
  created_at       timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_merge_grant_pull_requests_grant_pr
  ON merge_grant_pull_requests (grant_id, pull_request_id);
CREATE INDEX IF NOT EXISTS idx_merge_grant_pull_requests_pr
  ON merge_grant_pull_requests (tenant_id, pull_request_id);

-- One grant per execution.
CREATE UNIQUE INDEX IF NOT EXISTS uq_merge_grants_execution ON merge_grants (execution_id);

-- The sweep's cohort read: a tenant's LIVE grants (neither consumed nor voided).
CREATE INDEX IF NOT EXISTS idx_merge_grants_open
  ON merge_grants (tenant_id, execution_id) WHERE consumed_at IS NULL AND voided_at IS NULL;

COMMENT ON TABLE merge_grants IS
  'PRD 48 §4.6: a person''s grant that ONE cloud run''s pull request merges into the base branch once the security verdict passes and CI is green, overriding the project''s merge settings. Merged by the PR merge sweep, which sets consumed_at.';
