-- "There is something new behind that version number" — the unread clock.
--
-- The changelog is reachable from every route (the marketing footer version and
-- the operator shell's legal corner both open the one app-wide panel), and
-- nothing ever told anyone there was something new behind it. So the affordance
-- only paid off for a user who thought to click a version string, which is not
-- how anybody discovers a feature.
--
-- A COLUMN, not a table: this is one timestamp per user, functionally dependent
-- on `users.id` and 1:1 with the row — the same argument `available_for_hire`
-- and `account_type_selected_at` make. A `product_updates_seen` table would be
-- a second party model for a fact the party already carries.
--
-- NULL is deliberately NOT backfilled. "Never opened the panel" is read as
-- `created_at` by the counter, so an account sees only what shipped since IT
-- did: a new signup is not greeted with a badge counting thirty-nine updates
-- that all predate them, and no backfill script has to guess a date.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS product_updates_seen_at TIMESTAMP;
