-- 0228_member_discipline.sql
-- member_profiles.discipline — the BUILDER-DISCIPLINE axis (the Jellyfish "extend
-- visibility beyond engineers" lens). Attributes a workforce member to the kind of
-- work they do — engineering | product | design | qa | devops | data | other —
-- orthogonal to memberKind (human vs agent). The workforce scorecards/metrics roll
-- up by this axis so delivery is attributable to PM / design / QA / etc., not just
-- human-vs-agent. Null = unassigned → the rollup buckets it under 'unassigned' so
-- every existing profile counts immediately with zero backfill. Idempotent /
-- re-runnable.

ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS discipline varchar(24);

CREATE INDEX IF NOT EXISTS idx_member_profiles_discipline
  ON member_profiles(discipline) WHERE discipline IS NOT NULL;
