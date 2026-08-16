-- A realization records what was BUILT and never what was LEARNED.
--
-- Every target states success criteria before it is built — 25 signups from
-- 500 visitors, ten wizard-of-oz requests inside the SLA, a 90% pass rate over
-- 20 trials — and `realizations.result` only ever held the BUILD outcome
-- (files, tickets, live URL). So the platform could say "you ran a smoke
-- test" and could not say "it failed and you built it anyway", which is the
-- single most valuable thing a register of proofs could tell a team.
--
-- ── WHY THESE THREE COLUMNS, AND NOT ONE JSONB BLOB ─────────────────────────
-- `verdict` is queried and filtered on ("what has this workspace tried, and
-- what worked?"), so it is a column, not a key inside `result`. `verdict_metric`
-- stays jsonb because the number that decides it differs by proof — a signup
-- count against a sample size, a pass rate against a trial count — and forcing
-- one shape onto both would either lose the trial count or grow a column per
-- target. `decided_at` is separate from `updated_at`: a rebuild bumps
-- `updated_at` without touching the verdict, and "when was this called" is a
-- fact worth keeping even after the row changes for an unrelated reason.
--
-- ── WHY THE CHECK CONSTRAINT ─────────────────────────────────────────────────
-- Unlike `target_key` (deliberately unconstrained so a ninth proof form is an
-- adapter, not a migration), the verdict vocabulary is closed: met, missed,
-- abandoned is the whole language this feature speaks, on the row and in the
-- UI that reads it, and a fourth value would be a typo nobody caught rather
-- than a new proof form.
--
-- ── WHERE THE VALUE COMES FROM ──────────────────────────────────────────────
-- `met`/`missed` are written by `application/realization/realizationVerdict.ts`,
-- rolled up from the decisive call a generated proof's own console (the demand
-- console, the POC harness) recorded through the SAME public, same-origin
-- `/__api/collections/<name>` write endpoint its signup/request form already
-- uses — never typed into this table directly. `abandoned` is the one value a
-- person sets, through `PATCH /api/realizations/:id/verdict`, because
-- abandoning is a judgement call with no number to compute.
ALTER TABLE realizations
  ADD COLUMN IF NOT EXISTS verdict        varchar(16),
  ADD COLUMN IF NOT EXISTS verdict_metric jsonb,
  ADD COLUMN IF NOT EXISTS decided_at     timestamp;

ALTER TABLE realizations
  DROP CONSTRAINT IF EXISTS realizations_verdict_check;
ALTER TABLE realizations
  ADD CONSTRAINT realizations_verdict_check
  CHECK (verdict IS NULL OR verdict IN ('met', 'missed', 'abandoned'));

COMMENT ON COLUMN realizations.verdict IS
  'met | missed | abandoned. met/missed are rolled up from the proof''s own console; abandoned is set by a person. Never typed for met/missed.';
COMMENT ON COLUMN realizations.verdict_metric IS
  'The number that decided it, straight from the console that computed it — e.g. {"metricLabel":"Signups","metricValue":31,"target":25,"sample":500}.';
COMMENT ON COLUMN realizations.decided_at IS
  'When the verdict was recorded — the console submission''s own timestamp for met/missed, or the moment a person marked it abandoned. Distinct from updated_at, which a rebuild also bumps.';
