-- 1152 · A steer that lands after a run's last turn starts a follow-up run.
--
-- Operator decision 2026-09-12: "steers that arrive after a run's last turn => spend
-- the tokens". Until now such a steer was marked consumed and dropped (a durable
-- `steer.dropped` timeline row was the only trace). It now auto-dispatches a
-- follow-up run on the same ticket branch, attributed to the person who sent it.
--
--   sent_by                 WHO sent the steer (users.id). The follow-up run is
--                           human-directed, so it is submitted under this person.
--   late_claimed_at         Set exactly once, by the atomic claim that turns the steer
--                           into a follow-up. The idempotency key: a retried frame (or
--                           a second terminal chokepoint) finds it set and dispatches
--                           nothing.
--   late_outcome            'started' | 'awaiting_approval' | 'refused' | 'failed' |
--                           'released' — what became of the late steer.
--   follow_up_execution_id  The run it started, when one started.
--   late_detail             The refusal / failure sentence, when none started.
ALTER TABLE execution_messages
  ADD COLUMN IF NOT EXISTS sent_by                varchar(128),
  ADD COLUMN IF NOT EXISTS late_claimed_at        timestamp,
  ADD COLUMN IF NOT EXISTS late_outcome           varchar(32),
  ADD COLUMN IF NOT EXISTS follow_up_execution_id integer REFERENCES executions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS late_detail            text;
