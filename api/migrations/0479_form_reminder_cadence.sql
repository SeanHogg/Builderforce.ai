-- A named-recipient form could not chase anybody, and it always could have.
--
-- `publishForm` mints one credential per named recipient and returned the
-- plaintext to its caller exactly once. Nothing was behind it: no send at publish
-- time, and no pass that asks who still owes an answer. The register recorded the
-- second half as blocked on a roster that does not exist yet — and that was
-- wrong. `form_recipients.responded_at` IS the roster: for
-- `audience_kind = 'namedRecipients'` the invited set is enumerated and the
-- answered set is stamped, so "who has not answered" is one predicate, not a
-- feature waiting on another feature.
--
-- ── WHY TWO COLUMNS ON `question_sets` AND NOT A NEW TABLE ──────────────────
-- These are exactly the two facts `signature_requests` already carries for the
-- identical question — `remind_after_days` (the cadence the author declared) and
-- `last_reminded_at` (when the sweep last acted). Same shape, same sweep pattern,
-- same 0-opts-out rule. A `form_reminders` table would be a second place a form's
-- own schedule lives, and the whole point of the collection primitive is that
-- publication is columns on the set rather than a parallel store.
--
-- ── WHY 0 IS THE DEFAULT AND NOT 3 ──────────────────────────────────────────
-- `signature_requests` defaults to 3 because a contract that goes quiet is a
-- problem by definition. A form is not: most are `anyoneWithLink` surveys with no
-- named audience to chase, and defaulting them to "email everybody in three days"
-- would turn every published question set into an unrequested mail campaign. 0
-- opts out, and the author opts IN by declaring a cadence.
ALTER TABLE question_sets
  ADD COLUMN IF NOT EXISTS remind_after_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminded_at  timestamp;

COMMENT ON COLUMN question_sets.remind_after_days IS
  'Days of silence before a named-recipient form chases the people who have not answered. 0 (the default) opts out entirely — honoured as opt-out, never as "immediately".';
COMMENT ON COLUMN question_sets.last_reminded_at IS
  'When the reminder sweep last chased this form. Stamped AFTER delivery, so a transport failure means the next tick retries rather than skipping a cycle.';

-- The sweep reads (status, audience_kind, remind_after_days) across every tenant
-- on a schedule. Without this it is a sequential scan of every question set the
-- platform has ever held, once a day, to find the handful that opted in.
CREATE INDEX IF NOT EXISTS idx_question_sets_reminders
  ON question_sets (status, audience_kind, remind_after_days, last_reminded_at);
