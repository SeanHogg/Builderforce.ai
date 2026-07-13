-- Migration: anonymous pending prompts (cross-device landing-prompt continuity)
--
-- A visitor who types a prompt on the marketing/landing page before signing up
-- has it stashed in localStorage (same-browser) AND recorded here (durable,
-- cross-device, plus abandoned-prompt analytics). `anon_id` is a client-minted
-- random id; on the first authenticated request the Brain claims the latest
-- unclaimed row for that anon_id (stamping user_id + claimed_at) and replays it.
-- Rows expire (expires_at) so the table self-trims; claimed rows are kept for
-- funnel analytics. No tenant scope — these exist before the user has one.
CREATE TABLE IF NOT EXISTS pending_prompts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id     VARCHAR(64) NOT NULL,
  prompt      TEXT NOT NULL,
  path        VARCHAR(512),
  user_id     VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMP NOT NULL,
  claimed_at  TIMESTAMP
);

-- Claim lookup: latest unclaimed, unexpired row for an anon_id.
CREATE INDEX IF NOT EXISTS idx_pending_prompts_anon ON pending_prompts(anon_id, claimed_at, created_at);
CREATE INDEX IF NOT EXISTS idx_pending_prompts_expires ON pending_prompts(expires_at);
