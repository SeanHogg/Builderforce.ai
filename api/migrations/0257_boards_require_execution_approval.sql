-- 0257_boards_require_execution_approval.sql
-- Board-level "require manager approval before execution" governance toggle.
--
-- High / urgent priority tickets are gated: running one opens a manager-approval
-- request before the agent executes (see evaluateExecutionApprovalGate). This
-- column lets a manager OVERRIDE that gate per board — when set FALSE, high/urgent
-- tickets on this board run without the approval step. Defaults TRUE so every
-- existing board keeps the current governance behaviour until a manager opts out.
--
-- Idempotent / re-runnable: ADD COLUMN IF NOT EXISTS with a default.

ALTER TABLE boards ADD COLUMN IF NOT EXISTS require_execution_approval BOOLEAN NOT NULL DEFAULT TRUE;
