-- 1074_tenant_working_calendars.sql
-- The tenant's WORKING CALENDAR — which days this workspace actually works.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- `application/planning/scheduleWork.ts` decided "is this a working day?" with a
-- hardcoded Monday-to-Friday test. That is wrong for every tenant that does not
-- run a Western working week, and it is wrong for EVERY tenant across a public
-- holiday or a company shutdown: the planner drew committed capacity over days
-- nobody was going to work, and the first person to notice was whoever missed
-- the date. A schedule is a promise about people's time; it cannot be computed
-- from a constant.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────
-- ONE row per tenant. `working_weekdays` is the set of weekday numbers
-- (0 = Sunday … 6 = Saturday) that count as working days; `holidays` is a list
-- of `{ "date": "YYYY-MM-DD", "name": "…" }` objects so the settings UI can show
-- a human why a day is closed instead of an unexplained gap in the Gantt.
--
-- Both are JSON rather than child tables on purpose: they are a small, ordered,
-- wholly-replaced VALUE owned by exactly one row, never joined to and never
-- queried by member. A `tenant_holidays` table would add a second write path and
-- a second cache to invalidate for a list that is edited as one unit.
--
-- ── DEFAULT ─────────────────────────────────────────────────────────────────
-- No row means Monday-to-Friday with no holidays, which is EXACTLY what the
-- hardcoded rule did. A tenant that configures nothing must schedule identically
-- to how it scheduled the day before this shipped — the migration inserts
-- nothing and the loader falls back, so that holds by construction.

CREATE TABLE IF NOT EXISTS tenant_working_calendars (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Weekday numbers that are worked. Matches JS getUTCDay(): 0 = Sunday.
  working_weekdays jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  -- [{ "date": "2026-12-25", "name": "Christmas Day" }, …]
  holidays         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- IANA zone the calendar was authored in. Advisory only: schedules are whole
  -- UTC days, so this labels the intent rather than shifting the arithmetic.
  timezone         varchar(64),
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now()
);

-- A tenant has ONE calendar. The settings write is an upsert on this key, so a
-- concurrent save can never leave two rows disagreeing about the working week.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_working_calendars_tenant
  ON tenant_working_calendars (tenant_id);
