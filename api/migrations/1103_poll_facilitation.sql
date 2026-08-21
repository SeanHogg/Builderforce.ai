-- 1103 — The facilitation layer: a question put to a ROOM.
--
-- ── WHAT WAS MISSING ─────────────────────────────────────────────────────────
-- The canvas could hold a `timer` and a `comment` thread and nothing else a person
-- standing in front of a room actually uses. A board could be BUILT collaboratively
-- and never FACILITATED: no way to ask twelve people a question, no way for them to
-- answer from a phone with no account, and no way for the answer to appear on the
-- board everyone is looking at.
--
-- ── WHY THERE IS NO `polls` TABLE AND NO `poll_votes` TABLE ──────────────────
-- Because `question_sets` and `responses` already ARE the question and the answer
-- store — they absorbed twelve survey tables and thirteen answer tables, and
-- migration 0469 gave a set a public address (`slug`), an anonymity switch and an
-- enforceable audience. A poll is a question set whose `kind` is 'poll'. A kind is
-- a column value; a second pair here would be the third response store the kernel's
-- own note warns about in as many words, and it would give the product two answers
-- to "what did this person answer".
--
-- What genuinely did not exist is ONE fact and ONE constraint.
--
-- ── THE FACT: `show_results_live` ────────────────────────────────────────────
-- Whether the ROOM sees the running count on their own phones. Its own column
-- rather than a `status` value, because it is decided INDEPENDENTLY of whether
-- voting is open: a facilitator hides the count while people vote (so the first
-- three answers do not decide the rest) and reveals it with voting still open.
-- Folding it into `status` would make "reveal" mean "close", which is the one thing
-- a facilitator has to be able to do separately.
--
-- It defaults TRUE because a poll whose result nobody sees is a survey, and the
-- surveys already published through this table are unaffected: they are read by
-- `summarizeForm`, which never asks this column.
ALTER TABLE question_sets
  ADD COLUMN IF NOT EXISTS show_results_live boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN question_sets.show_results_live IS
  'Whether the room sees the running tally on their own devices. A facilitation decision taken independently of whether voting is open — hiding the count while people vote is what stops the first three answers deciding the rest.';

-- ── THE CONSTRAINT: ONE VOTE PER PARTICIPANT, WITHOUT AN IDENTITY ────────────
-- A poll is answered by people with no account, from a phone, and (usually)
-- anonymously — so there is deliberately no respondent to key a ballot on. The
-- promise an anonymous poll makes is that there is nothing to join, and a column
-- holding a device fingerprint would be a column somebody eventually joins.
--
-- `submission_id` is the answer, and it is the reason that column exists: it groups
-- one person's answers to each other and to nothing else. A participant's device
-- keeps its own submission id and sends it with every vote, so re-voting REPLACES
-- the previous answer instead of stuffing the ballot — a person may change their
-- mind, and nobody's identity is stored to make that possible.
--
-- That upsert needs a unique target. Partial, because a scorecard response has no
-- submission id and must not be constrained by one; and keyed on `question_key` as
-- well because a FORM submission is many rows sharing one submission id, one per
-- question — the same index has to be true for both writers of this table.
CREATE UNIQUE INDEX IF NOT EXISTS uq_responses_submission_question
  ON responses (question_set_id, submission_id, question_key)
  WHERE submission_id IS NOT NULL;

-- The tally reads every vote for one set. Without this it is a scan of every answer
-- the platform holds, once per refresh, in front of a room watching the screen.
CREATE INDEX IF NOT EXISTS idx_responses_set_submitted
  ON responses (question_set_id, submitted_at);
