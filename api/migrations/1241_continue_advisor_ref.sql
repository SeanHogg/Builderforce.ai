-- 1241 · Founder → advisor relation (A5, ticket #5236).
--
-- After a completed session the founder continues THAT advisor instead of
-- searching the marketplace again. The pointer is a nullable integer on the
-- founder's user row (`users.advisor_reservation_id` → `booking_reservations.id`),
-- the same shape as `consultant_consultations.reservation_id`: a bare integer,
-- null when the founder has no continued relationship.
--
-- The booker IS the founder (`booking_reservations.booker_ref` = `users.id`).
-- `companies` has no owner-user column, so a completed session cannot be
-- resolved to a company row. The reservation lives in the advisor's tenant and
-- the user row is global, so there is no foreign key — the same reason
-- `consultant_consultations.reservation_id` is a bare integer.
--
-- Not a new table.

ALTER TABLE users ADD COLUMN IF NOT EXISTS advisor_reservation_id INTEGER;
