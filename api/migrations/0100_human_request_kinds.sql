-- 0100_human_request_kinds.sql
-- Generalize the approvals table into human-in-the-loop "requests" the agent can
-- bubble up: 'approval' (approve/reject), 'question' (needs a free-text answer),
-- or 'feedback' (wants review/comments). Questions/feedback resolve to a new
-- 'answered' status carrying the human's text in response_text. One table + one
-- blocking gate serves all three so the agent can pause for a human on demand.
ALTER TYPE approval_status ADD VALUE IF NOT EXISTS 'answered';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS kind varchar(32) NOT NULL DEFAULT 'approval';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS response_text text;
-- The portal queue filters by (tenant, status) and by kind; keep both cheap.
CREATE INDEX IF NOT EXISTS idx_approvals_tenant_status ON approvals (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_tenant_kind ON approvals (tenant_id, kind);
