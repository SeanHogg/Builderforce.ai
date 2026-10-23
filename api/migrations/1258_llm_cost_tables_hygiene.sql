-- 1258 · Retention + autovacuum for the LLM cost-optimisation tables (1254, 1255, 1257).
-- Mirror for the operational endpoint: transactional-migrations/0021.
--
-- Three tables landed without a place in the swept-table registry
-- (application/maintenance/sweptTablesBounded.ts), so nothing purged them and they
-- inherited the 0.2 autovacuum default that produced the 593 MB `manager_actions`
-- relation (see 1104). Their windows are declared beside the entries:
--
--   cascade_outcomes           90 days (floor 30 — the D2 training / D1 prior window)
--   llm_batch_jobs             30 days, SETTLED jobs only (floor 7). Core copy is the
--                              unsplit fallback; the live queue is on the operational
--                              endpoint (0020) and is tuned there by 0021.
--   llm_specialist_eval_cases  180 days (floor 90)
--
-- IF EXISTS keeps a database that never had the table from failing the migration.
ALTER TABLE IF EXISTS cascade_outcomes SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000);
ALTER TABLE IF EXISTS llm_batch_jobs SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000);
ALTER TABLE IF EXISTS llm_specialist_eval_cases SET (autovacuum_vacuum_scale_factor = 0.05);
