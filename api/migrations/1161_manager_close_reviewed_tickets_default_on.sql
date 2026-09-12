-- 1161 — THE MANAGER CLOSES REVIEWED TICKETS BY DEFAULT
--
-- Operator decision, 2026-09-12 (same day as 1153): "The manager should be on by default
-- (close reviewed tickets)."
--
-- The column stays NULLABLE with no stored default, because the default is not a DB fact:
-- NULL means "this workspace has no opinion", and the ONE place that turns no-opinion into
-- a verdict is `DEFAULT_MANAGER_POLICY.managerMayCloseReviewedTickets`
-- (`application/manager/managerPolicy.ts`), now `true`. An account admin who wants a person
-- to sign every ticket on a human-gated review lane sets it to false explicitly.
--
-- So this migration only corrects the column's documentation, which 1153 wrote as
-- "NULL = false". No row is rewritten: an explicit false an admin already chose stays false.

COMMENT ON COLUMN tenant_manager_defaults.manager_may_close_reviewed_tickets IS
  'May the autonomous manager review and close a ticket through a human-gated review lane? Workspace-only, set by an account admin. NULL = no opinion = true (the manager closes a ticket whose review passes); false = a person closes every ticket on a human-gated review lane.';
