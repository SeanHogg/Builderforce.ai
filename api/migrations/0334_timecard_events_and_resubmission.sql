-- 0334_timecard_events_and_resubmission.sql
-- Timecard lifecycle audit trail + resubmission accounting (task #376).
--
-- Migration 0269 created `timecards` with the status column and the submit/approve
-- timestamps, but the lifecycle had no AUDIT surface: once a card moved
-- draft → submitted → approved|rejected, nothing recorded WHO moved it, WHEN, or
-- FROM WHICH state. Finance cannot reconcile a billable line, and support cannot
-- answer "why is this card back in draft?", without that trail.
--
-- Two additive changes, both safe to re-run:
--
--   1) `timecard_events` — an append-only row per state transition, carrying the
--      from/to status, the actor and the role they acted as, and free-form JSON
--      metadata (rejection reason, approved amount). This is the evidence behind
--      every lifecycle claim on a timecard.
--
--   2) `resubmission_count` on `timecards` — how many times a worker has corrected
--      and resubmitted a rejected card. Rejection returns a card to `draft` (so the
--      existing draft-editing rules apply unchanged); this counter is what
--      distinguishes a first submission from a corrected one.
--
-- Purely additive: no existing column changes type, and no data is rewritten.

-- 1) Append-only lifecycle audit log.
CREATE TABLE IF NOT EXISTS timecard_events (
  id           bigserial PRIMARY KEY,
  timecard_id  varchar(36) NOT NULL REFERENCES timecards(id) ON DELETE CASCADE,
  from_status  varchar(20),
  to_status    varchar(20) NOT NULL,
  actor_id     varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  actor_role   varchar(20),            -- contractor | client | admin | system
  metadata     text,                   -- JSON: { reason } | { amountCents } | ...
  created_at   timestamp NOT NULL DEFAULT now()
);
-- The dominant read is "show me this card's history, newest first".
CREATE INDEX IF NOT EXISTS idx_timecard_events_card
  ON timecard_events(timecard_id, created_at DESC);
-- Operational support filters the trail by who acted.
CREATE INDEX IF NOT EXISTS idx_timecard_events_actor
  ON timecard_events(actor_id, created_at DESC);

-- 2) Resubmission accounting on the card itself.
ALTER TABLE timecards ADD COLUMN IF NOT EXISTS resubmission_count integer NOT NULL DEFAULT 0;
