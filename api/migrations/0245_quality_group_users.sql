-- 0245_quality_group_users.sql
-- Exact distinct affected-user counts for error groups. Replaces the approximate
-- (overcounting) increment on error_groups.user_count: the ingest path now inserts
-- (group_id, user_key) here with ON CONFLICT DO NOTHING, and bumps user_count only
-- for genuinely-new pairs (the RETURNING rows). Small set table (one row per
-- distinct user per group), swept with the group on delete (CASCADE).
CREATE TABLE IF NOT EXISTS error_group_users (
  group_id   uuid NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
  user_key   varchar(255) NOT NULL,
  first_seen timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_key)
);
