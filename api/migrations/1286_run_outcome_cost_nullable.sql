-- 1286 · run_model_outcomes.cost_usd_millicents becomes NULLABLE — the CORE-track mirror of transactional-migrations/0029.
--
-- An unknown cost is NULL, never free (see 0029). Expand only: DROP NOT NULL is idempotent and no existing row changes.
-- `runTelemetryDatabase()` resolves to THIS (core) handle wherever the operational endpoint is not split out.
ALTER TABLE run_model_outcomes ALTER COLUMN cost_usd_millicents DROP NOT NULL;
