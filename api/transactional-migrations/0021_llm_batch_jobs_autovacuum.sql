-- 0021 · Autovacuum for the operational copy of the D6 deferred-call queue (0020).
-- Mirror: migrations/1258. Retention is declared in application/maintenance/
-- sweptTablesBounded.ts (30 days, settled jobs only). The queue is claim-and-update
-- heavy — every job is updated through queued → submitted → completed — so dead tuples
-- accumulate far faster than rows; the 0.2 default would let it bloat between sweeps.
ALTER TABLE IF EXISTS llm_batch_jobs SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000);
