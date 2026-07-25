-- 0368 — Widen `executions.submitted_by` so a composed dispatcher label cannot
-- overflow the column (and take the dispatch down with it).
--
-- WHY
--
-- `submitted_by` names WHICH subsystem started a run — `system:lane-auto`,
-- `system:coordinator`, `manager:signoff-request:<ref>`, `user:<id>`. The ticket
-- lifecycle ledger now reads it to attribute a retry storm to the code responsible,
-- which is what turned "134 identical failures" into "134 identical failures, all
-- from system:coordinator". That makes the column diagnostic infrastructure, not a
-- decorative label.
--
-- But it was varchar(36), and the lane-approver paths COMPOSE it:
--
--   `${args.submittedBy}:lane-approver:${approver.roleKey}`
--
-- With `system:coordinator` (18 chars) plus `:lane-approver:` (15) the budget is 3
-- characters for the role key. `qa` fits. `architect` (9) does not, nor does
-- `product-manager` (15) or any tenant-custom role — Postgres rejects the INSERT with
-- 22001 (value too long) and the reviewer dispatch throws. That is a dispatch that
-- fails for a REASON UNRELATED TO THE WORK, on exactly the boards that configure
-- roles most carefully.
--
-- 128 leaves real headroom for `<base>:<kind>:<detail>` with a long custom role key,
-- and `composeDispatcherLabel` (application/runtime/dispatcherLabel.ts) clamps to the
-- same bound so the value is well-formed before it ever reaches the column — the
-- column width and the composer share one constant. Widening a varchar is a metadata-
-- only change in Postgres: no table rewrite, no lock beyond a brief ACCESS EXCLUSIVE.

ALTER TABLE executions ALTER COLUMN submitted_by TYPE varchar(128);

COMMENT ON COLUMN executions.submitted_by IS
  'WHICH dispatcher started this run (system:lane-auto | system:coordinator | manager:signoff-request:<ref> | <base>:lane-approver:<role> | user:<id> | …). Read by the ticket lifecycle ledger to attribute runs to the subsystem responsible. Compose it with composeDispatcherLabel() — never by raw template — so it cannot exceed 128.';
