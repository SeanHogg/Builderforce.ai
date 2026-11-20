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

-- WHO GRANTED IT MUST OUTLIVE THEM. `granted_by` is nullable and SET NULL on user deletion —
-- never CASCADE, which would delete the audit row that answers "who let this into main" — and
-- `granted_by_label` snapshots the person's name at grant time so the answer survives.
--
-- `last_considered_at` rotates the sweep's granted cohort (oldest-visited first), so a tenant's
-- held grants can never starve another tenant's. A grant also EXPIRES (void `expired`) seven
-- days after `created_at`; the sweep applies the expiry.
CREATE TABLE IF NOT EXISTS merge_grants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  execution_id        integer NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  granted_by          varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  granted_by_label    text NOT NULL,
  reason              text NOT NULL,
  created_at          timestamp NOT NULL DEFAULT now(),
  consumed_at         timestamp,
  voided_at           timestamp,
  void_reason         varchar(40),
  last_considered_at  timestamp,
  CONSTRAINT chk_merge_grants_reason CHECK (length(btrim(reason)) > 0)
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

-- CONVERGE. This file was amended before it reached production, so a dev database may hold an
-- EARLIER shape of these tables (`granted_by` NOT NULL + ON DELETE CASCADE, an unnamed reason
-- CHECK, no `granted_by_label` / `last_considered_at`, maybe no voiding columns, a per-tenant
-- open index). `CREATE TABLE IF NOT EXISTS` skips such a table, so every later change is also
-- applied idempotently below: a fresh database and an earlier one end in the SAME shape.
ALTER TABLE merge_grants ADD COLUMN IF NOT EXISTS voided_at timestamp;
ALTER TABLE merge_grants ADD COLUMN IF NOT EXISTS void_reason varchar(40);
ALTER TABLE merge_grants ADD COLUMN IF NOT EXISTS last_considered_at timestamp;
ALTER TABLE merge_grants ADD COLUMN IF NOT EXISTS granted_by_label text;
-- Backfill the label from the person (or their id) before it becomes NOT NULL.
UPDATE merge_grants AS g
   SET granted_by_label = COALESCE(
         (SELECT COALESCE(NULLIF(btrim(u.display_name), ''), u.username, u.email) FROM users AS u WHERE u.id = g.granted_by),
         g.granted_by,
         'unknown')
 WHERE g.granted_by_label IS NULL;
ALTER TABLE merge_grants ALTER COLUMN granted_by_label SET NOT NULL;
ALTER TABLE merge_grants ALTER COLUMN granted_by DROP NOT NULL;
-- The person FK: SET NULL, never CASCADE (both shapes name it merge_grants_granted_by_fkey).
ALTER TABLE merge_grants DROP CONSTRAINT IF EXISTS merge_grants_granted_by_fkey;
ALTER TABLE merge_grants
  ADD CONSTRAINT merge_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL;
-- The reason CHECK under its one name (the earlier shape's was the inline, auto-named one).
ALTER TABLE merge_grants DROP CONSTRAINT IF EXISTS merge_grants_reason_check;
ALTER TABLE merge_grants DROP CONSTRAINT IF EXISTS chk_merge_grants_reason;
ALTER TABLE merge_grants ADD CONSTRAINT chk_merge_grants_reason CHECK (length(btrim(reason)) > 0);
-- The earlier per-tenant open index is replaced by the rotation index below.
DROP INDEX IF EXISTS idx_merge_grants_open;

-- The sweep's cohort read: LIVE grants (neither consumed nor voided), least-recently visited first.
CREATE INDEX IF NOT EXISTS idx_merge_grants_rotation
  ON merge_grants (last_considered_at NULLS FIRST, created_at) WHERE consumed_at IS NULL AND voided_at IS NULL;

COMMENT ON TABLE merge_grants IS
  'PRD 48 §4.6: a person''s grant that ONE cloud run''s pull request merges into the base branch once the security verdict passes and CI is green, overriding the project''s merge settings. Merged by the PR merge sweep, which sets consumed_at.';
