-- 0029 · run_model_outcomes.cost_usd_millicents becomes NULLABLE (expand only).
--
-- An unknown cost is NULL, never free. The cloud scorer recorded 0 for a run with no usage rows or whose lookup threw,
-- so a failed lookup read as a free run to the router and the dashboards. A genuine 0 (BYO / local with usage rows that
-- really sum to 0) stays 0. Existing rows are untouched; the column default stays 0 for writers that do not report cost.
ALTER TABLE run_model_outcomes ALTER COLUMN cost_usd_millicents DROP NOT NULL;
