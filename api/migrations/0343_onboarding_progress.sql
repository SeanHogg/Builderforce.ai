-- Resumable onboarding: persist WHICH setup steps a user has finished.
--
-- Before this, only the terminal `onboarding_completed_at` was stored, so a user
-- who closed the wizard mid-way restarted at step 1 on the next visit. The
-- wizard now has two account-type tracks (builder: workspace…invite, hired:
-- talentProfile…findWork), so progress is recorded by STEP ID — stable across
-- tracks and reorderings, unlike the previous index-based in-memory state.
--
-- Shape (JSON text, validated app-side):
--   { "track": "builder" | "hired", "completed": ["workspace","project"], "activeStep": "ticketing" }

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_progress text;
