-- 1153 — MAY THE AUTONOMOUS MANAGER REVIEW AND CLOSE A TICKET?
--
-- Operator decision, 2026-09-12: "The autonomous Manager can review and close a ticket —
-- this should be a setting the ADMIN of the account sets."
--
-- Every board on the reference workspace gates `in_review` as `human`. Stall triage and
-- the census escalate those tickets as `human_gate` by design (the manager must not
-- override a gate a human configured), while the manager's CONDUCT step never read the
-- gate at all and closed review-ready tickets anyway — two readings of one rule. The
-- setting below is the one answer both now read (`application/manager/reviewGateAuthority.ts`):
--
--   NULL / false (the default) — a human-gated review lane holds; a person closes it.
--   true                       — the manager's review verdict is the approval, and a
--                                passing ticket is closed under this setting's authority
--                                (ledger + `managed.gate_override` audit row).
--
-- WORKSPACE-ONLY: no project_manager_configs column, because the operator made it an
-- account-admin decision, not a per-project grant. Written only through
-- PATCH /api/manager/defaults, which requires the MANAGER role.

ALTER TABLE tenant_manager_defaults
  ADD COLUMN IF NOT EXISTS manager_may_close_reviewed_tickets boolean;

COMMENT ON COLUMN tenant_manager_defaults.manager_may_close_reviewed_tickets IS
  'May the autonomous manager review and close a ticket through a human-gated review lane? Workspace-only, set by an account admin. NULL = no opinion = false (a person closes every ticket on a human-gated review lane).';
