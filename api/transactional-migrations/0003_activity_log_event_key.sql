-- activity_log.event_key on the OPERATIONAL database.
--
-- Migration 0374 added event_key (the idempotency key the execution-lifecycle
-- outbox projects on) to the primary track only. But activity_log LIVES here:
-- recordActivity/getActivityLog both switch to buildTransactionalDatabase
-- whenever NEON_TRANSACTIONAL_DATABASE_URL is bound, which is production.
--
-- Consequence: EVERY activity write failed with
--   column "event_key" of relation "activity_log" does not exist
-- ~350 times an hour, silently — recordActivity swallows its own errors by
-- design, so the unified audit log simply recorded nothing. This is the same
-- wrong-track defect as 0002 (api_error_log), on the table that is supposed to
-- be the ONE audit store.
--
-- The unique index is what makes outbox projection idempotent (ON CONFLICT DO
-- NOTHING), so it has to come across too. It is a UNIQUE index on a NULLABLE
-- column: Postgres treats NULLs as distinct, so the many legacy rows with a null
-- event_key do not collide.

ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS event_key varchar(160);

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_log_event_key
  ON activity_log(event_key);
