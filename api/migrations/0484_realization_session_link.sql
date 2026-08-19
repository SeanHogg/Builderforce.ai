-- Link a proof back to the idea it is proving.
--
-- ── WHAT WAS UNMEASURABLE WITHOUT THIS ──────────────────────────────────────
-- The method is Read → Prove → Build → Measure, and the whole opinion of it is
-- that the last act is the one teams skip: every proof states a KILL CONDITION
-- before it is built, and a proof whose condition was never graded is a launch
-- with extra steps. The platform's north-star metric is therefore "share of
-- ideas that reached a GRADED proof".
--
-- Every value metric is computed from `creation_outcome_events`, whose grain is
-- the Creation Session — that is what "session, project, tenant, platform"
-- aggregation means. Realizations had no session, so the loop could not record
-- itself into the ledger at all: the platform could count deliverables and
-- could not count graded proofs, which is the one number that distinguishes
-- this method from shipping.
--
-- ── WHY NULLABLE, AND WHY SET NULL ──────────────────────────────────────────
-- A proof can legitimately be started outside a board (the standalone Realize
-- page, or a brief that came through the challenge pipeline). Such a proof is
-- not a hole in the measurement — it is an idea that never entered the ledger's
-- grain, and inventing a synthetic session for it would put a row in a
-- denominator no scorecard could explain. ON DELETE SET NULL because deleting a
-- board must never delete the record of a proof that may still be live at a URL
-- somebody has already been sent.
ALTER TABLE realizations
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES creation_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_realizations_session ON realizations (session_id);

COMMENT ON COLUMN realizations.session_id IS
  'The Creation Session whose idea this proof is of. Null when the proof was started outside a board; such a proof records no outcome events, because the outcome ledger''s grain is the session.';
