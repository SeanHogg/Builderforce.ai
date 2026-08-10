-- A null stage_key represents the ticket-wide/default manifest slot. The old
-- unique index treated every NULL as distinct, allowing the same generic role
-- slot to be inserted repeatedly and defeating derive/assessment idempotency.
--
-- Production was audited before this migration was authored and contained no
-- duplicate groups under the corrected equality rule, so replacing the index is
-- safe without deleting or guessing at participant evidence.

DROP INDEX IF EXISTS uidx_ticket_participants_slot;

ALTER TABLE ticket_participants
  ADD CONSTRAINT uidx_ticket_participants_slot
  UNIQUE NULLS NOT DISTINCT (task_id, stage_key, role_key, responsibility, source);
