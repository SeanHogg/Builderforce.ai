-- 0004_activity_log_object_registry.sql
--
-- The registry reference the (target_type, target_id) pair could never enforce
-- (PRD 20 §2). `activity_log` lives on the OPERATIONAL track — it is written to
-- NEON_TRANSACTIONAL_DATABASE_URL, so the column has to be added here rather
-- than alongside the rest of the kernel in api/migrations/0418.
--
-- Nullable, and NO foreign key: `objects` lives on the operational track's
-- sibling database, so the constraint cannot be declared across it. The
-- application resolves the reference; the column is what makes
-- `/api/objects/:id/activity` one endpoint instead of one per subsystem.

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS object_id UUID;
CREATE INDEX IF NOT EXISTS idx_activity_log_object ON activity_log (object_id, occurred_at);
