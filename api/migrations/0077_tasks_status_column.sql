-- Track tasks.status as a real migration instead of grandfathering it.
--
-- History: `tasks` was created by an early `drizzle-kit push` baseline, and
-- `status` was declared in schema.ts as the `task_status` pg enum
-- (`taskStatusEnum('status')`). The drift guard only sees column-builders it
-- recognises (varchar/text/pgEnum/...), NOT named enum builders, so an enum
-- `status` was invisible to it. Migration 0076 converted the column to a
-- free-form `varchar(64)` (schema.ts now: `varchar('status', { length: 64 })`),
-- which made the column visible to the guard and exposed that no migration ever
-- created it — it only ever existed via the baseline push.
--
-- This migration asserts the column so a migrations-only database is correct and
-- the schema is self-documenting. It is idempotent: on the baseline-pushed
-- production DB the column already exists (as varchar after 0076), so
-- ADD COLUMN IF NOT EXISTS is a no-op. On a fresh migrations-only DB where 0076's
-- guarded conversion found nothing to convert, this creates the column directly
-- as the free-form varchar with the canonical 'backlog' default.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status varchar(64) NOT NULL DEFAULT 'backlog';
