-- 1169 · Which ROLE a scored run's model played (plan · code · verify · explore · chat · utility).
--
-- Learned routing ranked models by action type alone, so a model's history as a planner and as a
-- coder was one number, and the gateway chat path, which routes by role (1167), had no evidence
-- keyed on the role it was choosing for. With this column the routing blob also carries per-role
-- stats (`byRole`), and "which connected model should write the code" is answered by the model
-- that has actually shipped accepted code for this tenant, not only by its catalog tier.
--
-- NULL = unknown. Existing cloud rows are backfilled to 'code': a cloud run's primary loop IS
-- coding work (`pickCloudModel` is called with role 'code'), so that is what those rows measured.
-- Client-reported rows (IDE / on-prem / external) stay NULL — nothing recorded which role they
-- played, and inventing one would teach the router evidence nobody captured.
ALTER TABLE run_model_outcomes
  ADD COLUMN IF NOT EXISTS role varchar(16);

UPDATE run_model_outcomes SET role = 'code' WHERE role IS NULL AND source = 'cloud';

COMMENT ON COLUMN run_model_outcomes.role IS
  'The model role this run scored (ModelRole: plan|code|verify|explore|chat|utility), or NULL when unknown. Feeds the routing blob''s byRole stats.';
