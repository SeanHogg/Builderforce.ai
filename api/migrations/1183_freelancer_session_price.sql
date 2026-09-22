-- 1183_freelancer_session_price.sql
--
-- Pro bono is a PRICE, not a flag.
--
-- An advisor who takes unpaid sessions had no way to say so. `hourly_rate_cents`
-- could not carry it: an advisor can bill hourly for project work and still take
-- introductory sessions for free, so folding the two would make "volunteers" and
-- "charges nothing at all" the same claim — and a seeker acts on that difference.
--
-- Deliberately NOT a boolean `is_pro_bono`. A boolean beside a price is two facts
-- about one thing that can contradict each other (`is_pro_bono = true` next to a
-- session price of 5000), and nothing in the schema decides which one wins. One
-- nullable integer cannot disagree with itself:
--
--   0      — volunteer / complimentary session. This is the pro-bono signal.
--   NULL   — no session price set. No badge, no price row; the default, so every
--            existing profile keeps saying exactly what it said before.
--   > 0    — a priced session.
--
-- NULL rather than 0 as the default is the whole safety property: backfilling 0
-- would silently advertise every advisor on the platform as free.
--
-- Cents, like every other money column here (`hourly_rate_cents`,
-- `desired_salary_min_cents`) — see the money-at-the-adapter-edge rule. Negative
-- values are rejected at the route, which normalises anything not a finite
-- non-negative number to NULL rather than storing a stale or hostile figure.

ALTER TABLE freelancer_profiles
  ADD COLUMN IF NOT EXISTS session_price_cents INTEGER;

COMMENT ON COLUMN freelancer_profiles.session_price_cents IS
  'Advisory session price in cents. 0 = pro bono / volunteer, NULL = not set, >0 = priced.';
