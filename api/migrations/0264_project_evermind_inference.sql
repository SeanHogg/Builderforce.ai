-- 0264_project_evermind_inference.sql
-- Opt-in consumer flag for the per-project Evermind model.
--
-- Seeding a project Evermind (0258) makes a learnable model AVAILABLE, but nothing
-- ran on it — the `project_evermind:<projectId>` pin had no emitter. This flag is
-- that emitter: when TRUE (and the model is seeded), agent runs for the project's
-- tasks resolve their inference model to the project's current Evermind head
-- (pull-on-boundary), so every surface (cloud / on-prem / IDE) actually RUNS on the
-- project's self-learning model. Independent of `mode` (which governs write-back):
-- a project can read its Evermind without contributing, or contribute without
-- reading. Default FALSE = today's behaviour (plan-default coding model).
ALTER TABLE project_evermind
  ADD COLUMN IF NOT EXISTS inference_enabled BOOLEAN NOT NULL DEFAULT FALSE;
