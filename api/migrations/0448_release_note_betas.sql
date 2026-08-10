-- Product-update lifecycle + self-serve beta enrolment (0448).
--
-- A release note gains a STAGE (where it is in its lifecycle) alongside its
-- existing CATEGORY (what kind of change it is). `beta_opt_in` is what makes a
-- beta joinable — a private beta with opt-in false stays invitation-only and is
-- never offered in the banner. `stage_ends_at` is the one date a stage carries:
-- "scheduled for release" on a beta, "upcoming sunset" on a sunset.
ALTER TABLE release_notes
  ADD COLUMN IF NOT EXISTS stage         VARCHAR(24) NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS beta_opt_in   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS beta_terms    TEXT,
  ADD COLUMN IF NOT EXISTS stage_ends_at TIMESTAMP;

-- One row per (note, user): the enrolment IS the fact and `status` is its current
-- state, so leaving and rejoining updates in place. `agreed_at`/`agreed_terms_hash`
-- record WHEN someone consented and to WHICH text — a later edit of the terms is
-- then detectable rather than silently rewriting what they agreed to. A dismissal
-- carries neither, because declining is not consent.
CREATE TABLE IF NOT EXISTS release_note_beta_enrollments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_note_id   UUID NOT NULL REFERENCES release_notes(id) ON DELETE CASCADE,
  user_id           VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            VARCHAR(16) NOT NULL DEFAULT 'joined',
  agreed_at         TIMESTAMP,
  agreed_terms_hash VARCHAR(64),
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_release_note_beta_enrollment
  ON release_note_beta_enrollments (release_note_id, user_id);

CREATE INDEX IF NOT EXISTS idx_release_note_beta_enrollment_user
  ON release_note_beta_enrollments (user_id);
