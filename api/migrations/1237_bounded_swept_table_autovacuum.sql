-- 1237 · Per-table autovacuum tuning for the bounded-retention tables (sweptTablesBounded.ts).
--
-- Same reasoning as 1104: the default scale factor (0.2) lets a purged table carry 20% dead
-- tuples before autovacuum runs, and core sits at 504/512 MB on Neon Free. 0.05 reclaims
-- pages after each nightly bounded purge; these feeds are lower-write than manager_actions,
-- so the tighter 0.02 of 1104 is not needed. IF EXISTS: a table a fresh database never
-- created must not abort the migration. Guarded by scripts/check-swept-tables.mjs.
ALTER TABLE IF EXISTS telemetry_spans SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS connector_call_logs SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS outbound_fetch_log SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS agent_inference_logs SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS catalog_adoption_events SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS newsletter_events SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS email_delivery_failures SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS webhook_deliveries SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS deliveries SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS monitor_events SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS alert_events SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS ide_training_logs SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS marketing_sessions SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS marketing_session_prompts SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS marketing_heatmap_pages SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS project_insight_events SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS usage_snapshots SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS run_model_outcomes SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS replay_visit_summaries SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS replay_releases SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS auth_tokens SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS auth_user_sessions SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS magic_link_tokens SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS email_otp_challenges SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS device_authorizations SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS execution_limits SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS preview_sessions SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS resource_leases SET (autovacuum_vacuum_scale_factor = 0.05);
