-- 1249_advisory_meeting_reservation_ref.sql
--
-- WHY. `provisionAdvisorySession` found the advisory meeting by
-- `meetings.description = 'advisory-reservation:<id>'` and inserted one when the
-- find came back empty. Nothing constrained that: two concurrent confirms of the
-- same reservation both missed and both inserted — two meetings, two calendar
-- events, two restricted threads for one booking.
--
-- The reservation reference becomes a real column with a partial UNIQUE index, so
-- the insert is `ON CONFLICT DO NOTHING` and the loser reads the winner's row.
-- No foreign key: the reservation and the meeting live in the same (advisor)
-- tenant, but `booking_reservations` rows are deleted independently of meetings.
--
-- Backfill takes the reference from the legacy description stamp. When a race
-- already produced duplicates, only the EARLIEST meeting per reservation is
-- stamped (the one later provisions would have found first); the others keep
-- their description and stay as they are.
--
-- DOWN. DROP INDEX uq_meetings_advisory_reservation; ALTER TABLE meetings DROP
-- COLUMN advisory_reservation_id;

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS advisory_reservation_id INTEGER;

WITH stamped AS (
  SELECT DISTINCT ON (tenant_id, substring(description FROM '^advisory-reservation:([0-9]+)$')::int)
         id,
         substring(description FROM '^advisory-reservation:([0-9]+)$')::int AS reservation_id
  FROM meetings
  WHERE kind = 'advisory'
    AND advisory_reservation_id IS NULL
    AND description ~ '^advisory-reservation:[0-9]+$'
  ORDER BY tenant_id, substring(description FROM '^advisory-reservation:([0-9]+)$')::int, created_at ASC, id ASC
)
UPDATE meetings m
SET advisory_reservation_id = stamped.reservation_id
FROM stamped
WHERE m.id = stamped.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_advisory_reservation
  ON meetings (tenant_id, advisory_reservation_id)
  WHERE advisory_reservation_id IS NOT NULL;

COMMENT ON COLUMN meetings.advisory_reservation_id IS
  'booking_reservations.id this advisory meeting was provisioned for (A1). Unique per tenant; null for every other meeting kind.';
