-- 1061 — the weekly release digest stops being an unbounded, unresumable send.
--
-- WHAT WAS WRONG
-- ------------------------------------------------------------------------------
-- `runReleaseDigest` selected EVERY verified, non-suspended user in one query
-- and walked the whole array in 10-wide batches. Three failures were latent in
-- that:
--
--   1. the audience read is unbounded — one array of every account in Worker
--      memory, and one query whose cost grows with the user base;
--   2. a Worker eviction part-way through loses the progress, and because the
--      notes are stamped `emailed_at` only at the END, the retry starts from
--      the first recipient — everyone already mailed is mailed AGAIN;
--   3. nothing honours Resend's rate window, so a large audience is a burst.
--
-- WHAT THIS ADDS
-- ------------------------------------------------------------------------------
-- One row per digest RUN, keyed on the exact note set it carries. The runner
-- pages the audience by keyset (`users.id > cursor ORDER BY id`) and writes the
-- cursor after each page, so a resumed run continues from the last recipient it
-- actually mailed instead of re-sending. The notes are stamped only when the run
-- reaches `completed`.
--
-- `note_ids` is the identity of a run, not a payload: two invocations carrying
-- the same notes ARE the same send, which is what makes "resume" meaningful and
-- what stops a re-triggered cron from starting a parallel duplicate.

CREATE TABLE IF NOT EXISTS release_digest_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable fingerprint of the ordered note-id set this run carries.
  note_key      VARCHAR(64) NOT NULL,
  note_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 'running' | 'completed'. A run left 'running' is what a later invocation resumes.
  status        VARCHAR(16) NOT NULL DEFAULT 'running',
  -- Keyset position: the id of the last recipient this run finished with.
  cursor_user_id VARCHAR(36),
  recipients    INTEGER NOT NULL DEFAULT 0,
  sent          INTEGER NOT NULL DEFAULT 0,
  suppressed    INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  started_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMP
);

-- One live run per note set: the partial unique index is what makes a second
-- invocation resume the existing run rather than open a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_release_digest_run_open
  ON release_digest_runs (note_key)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_release_digest_runs_started
  ON release_digest_runs (started_at DESC);
