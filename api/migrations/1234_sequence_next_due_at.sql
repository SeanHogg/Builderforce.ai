-- 1234 · creation_session_objects.next_due_at — the cadence sweep's due time.
--
-- The sequence runner ran on every active cron tick and read up to 40 cadence JSON blobs
-- to discover, in JS, that none had a step due — the common case, since cadence steps are
-- days apart. It now stores the answer: next_due_at is the earliest moment any enrolled
-- person is due a step (sequenceNextDueAt, the same rule that decides what to send), and
-- the sweep selects only `next_due_at IS NULL OR next_due_at <= now()`. An idle tick is
-- one indexed statement that returns nothing.
--
-- WHY A TRIGGER. A cadence is authored through every canvas write path (graph rewrites,
-- object patches, the Brain's tools), none of which know about due times. Rather than
-- teach each one, any change to a sequence's `content` that does not also set
-- next_due_at clears it to NULL ("unknown"), and the runner re-evaluates and re-stamps it
-- on its next tick. The runner itself writes content and next_due_at together, so its
-- own stamp survives. Inserts (including graph rewrites, which delete and re-insert every
-- object) always start unknown.
ALTER TABLE creation_session_objects ADD COLUMN IF NOT EXISTS next_due_at timestamp;

CREATE OR REPLACE FUNCTION reset_sequence_next_due() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.next_due_at := NULL;
  ELSIF NEW.content IS DISTINCT FROM OLD.content
        AND NEW.next_due_at IS NOT DISTINCT FROM OLD.next_due_at THEN
    NEW.next_due_at := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_creation_objects_sequence_due ON creation_session_objects;
CREATE TRIGGER trg_creation_objects_sequence_due
  BEFORE INSERT OR UPDATE ON creation_session_objects
  FOR EACH ROW
  WHEN (NEW.kind = 'sequence')
  EXECUTE FUNCTION reset_sequence_next_due();

-- Serves the sweep's `next_due_at IS NULL OR next_due_at <= now` + `ORDER BY next_due_at
-- NULLS FIRST`. Partial: only cadences, a handful of rows among every canvas object.
CREATE INDEX IF NOT EXISTS idx_creation_objects_sequence_due
  ON creation_session_objects (next_due_at NULLS FIRST)
  WHERE kind = 'sequence';
