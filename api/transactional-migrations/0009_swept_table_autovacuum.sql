-- 0009 · Per-table autovacuum tuning for the retention-swept log tables that live on
-- the OPERATIONAL (transactional) endpoint. Mirror of migrations/1104 — see that file
-- for the full reasoning; the split exists only because these four relations are in a
-- different Neon database and the two runners never cross.
--
-- `autovacuum_vacuum_scale_factor` defaults to 0.2, which is far too lax for a feed
-- taking a row per LLM call or per handled exception: autovacuum arrives long after
-- the relation has already extended rather than reused its pages.
--
-- FILLFACTOR is set on `llm_traces` alone, because it is the only relation in the
-- swept set whose rows are UPDATEd after insert (a stream finalises its row) and so
-- the only one where reserved page space buys HOT updates. On the pure-append tables
-- it would permanently waste 10% of the storage this migration exists to reduce.

ALTER TABLE llm_traces        SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                   autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000,
                                   fillfactor = 90);
ALTER TABLE llm_failover_log  SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                   autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE llm_health_probes SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                   autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE api_error_log     SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                   autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
