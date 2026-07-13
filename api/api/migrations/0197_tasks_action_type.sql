-- 0197_tasks_action_type.sql
-- Learned Model Routing (PRD 13), phase 1 — label every task with an ACTION TYPE.
--
-- A cheap free-model classifier runs ONCE per task and caches its verdict here, so
-- every re-run of the same ticket reuses the label instead of re-classifying. The
-- label is the join key that lets us learn which model performs best for which kind
-- of work (sql / frontend_ui / backend_api / refactor / …). Null = unclassified;
-- the router treats null as 'other'.
--
--   action_type            — the cached closed-enum label (see actionTypes.ts).
--   action_type_confidence — the classifier's 0..1 self-reported confidence; kept
--                            as a diagnostic so low-confidence labels can be
--                            re-classified later without a schema change.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS action_type varchar(32);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS action_type_confidence real;
