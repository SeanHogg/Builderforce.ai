-- 1092 — A canvas workflow's "Approval required" becomes a GATE, not a caption.
--
-- ── WHAT IT REPLACES ────────────────────────────────────────────────────────
-- The Creation Canvas has offered an `approvalMode` select on every `workflow`
-- object since the kind was registered — "Approval required before publish" /
-- "Fully autonomous". It was authored, saved onto the object, rendered on the
-- card, and then dropped: `compileWorkflow` never sent it, `from-canvas` had
-- nowhere to put it, and `POST /:id/run` never asked. A board that read
-- "Approval required" dispatched agent work with no approver anywhere in the
-- path — the worst kind of governance failure, because the UI says the control
-- is on.
--
-- ── WHY A COLUMN AND NOT A RULE ─────────────────────────────────────────────
-- `approval_rules` already exists, and auto-approval thresholds live there. It
-- is the wrong home: a rule is a tenant-wide policy about a CLASS of action,
-- while this is one definition's own authored setting, chosen on the card next
-- to its steps. Expressing it as a rule would mean a workspace could not have
-- one gated workflow and one autonomous one, which is the entire distinction
-- the two options offer.
--
-- ── WHY THE DEFAULT IS 'autonomous' ─────────────────────────────────────────
-- Every definition that exists today runs the moment it is triggered, and
-- nothing has ever opened an approval for one. Backfilling them to 'required'
-- would freeze every scheduled and trigger-fired workflow in the product behind
-- an approval no one asked for and no one is watching for. The default is what
-- these rows have always MEANT; only a definition authored with the gate on
-- carries 'required'.
--
-- The gate itself reuses the `approvals` table and the same approve-then-start
-- replay that `task.execution` uses (see application/approval/approvalGate.ts).
-- No second approval concept is introduced.

ALTER TABLE workflow_definitions
  ADD COLUMN IF NOT EXISTS approval_mode varchar(16) NOT NULL DEFAULT 'autonomous';

-- "Which of this workspace's workflows are gated?" — the governance read, and the
-- reason the gate is a column rather than a JSON field on `definition`. Partial:
-- the gated set is the small one, and the ungated majority never needs a row read.
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_gated
  ON workflow_definitions (tenant_id)
  WHERE approval_mode = 'required';
