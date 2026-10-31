-- 1287 · Retire a dead table and drop prefix-redundant indexes on the non-hot tables.
--
-- Operator-approved (2026-10-31) from the 2026-10-17 architecture review's held items. Split across three files so the hot
-- tables (1288) and the rebuilt index (1289) are not locked in the same transaction as this file's many drops. THIS file
-- still runs 57 locking statements in ONE transaction (the table drop and the 56 index drops, each taking ACCESS EXCLUSIVE on
-- its table), every lock held until COMMIT, while the OLD Worker is live. `SET LOCAL lock_timeout` below bounds each lock WAIT,
-- not how long the locks already taken are held:
--   1287 (this file)  A. the table drop + B. 56 prefix-redundant index drops on non-hot tables    1 table + 56 indexes
--   1288              B. 5 prefix-redundant index drops on the hot tables (tasks, objects, llm_usage_log,
--                     agent_memory, brain_chats; `executions` has no drop)                          5 indexes
--   1289              C. idx_knowledge_documents_segment rebuilt WHERE segment_id IS NOT NULL         1 index
-- The B drops total 61 across 1287 + 1288 (56 + 5). Every statement is idempotent (DROP … IF EXISTS / CREATE INDEX IF NOT EXISTS).
--
-- LOCKS. A plain DROP INDEX takes ACCESS EXCLUSIVE on its table until COMMIT, and scripts/migrate.mjs runs each file as ONE
-- transaction (sql.transaction over the Neon HTTP transport: BEGIN, every statement, the ledger INSERT, COMMIT). `SET LOCAL
-- lock_timeout` is the first statement of that transaction, so it bounds every lock wait in this file to 3s and reverts at COMMIT.
-- If a lock cannot be had in time the statement errors, the whole file rolls back (nothing half-applied, no ledger row), the
-- deploy fails cleanly BEFORE the Worker deploys, and the fix is to re-run the deploy.
--
-- WHY IT IS SAFE
--   A. Migration 1236 folded every row into artifact_likes (THE like store, application/marketplace/artifactLikes.ts) and
--      no reader or writer of marketplace_skill_likes remains in api/src, frontend/src, packages or clients. It has no
--      inbound foreign key and no view; its only FK points OUT (user_id → users ON DELETE CASCADE). Migrations run BEFORE
--      the new Worker deploys, so the OLD Worker runs against this schema — and it has no path to the table either (the
--      routes moved to artifact_likes in 1236's release), so the drop is a single-step contract with no expand phase.
--   B. Each dropped index S is a plain btree on plain columns (no expression, INCLUDE or WHERE), NOT unique and backing no
--      constraint, whose key columns, order and per-column sort options are an exact leading prefix of a strictly longer
--      plain btree index L on the same table. L is left in place, so every query S served is served by L. L may be unique
--      or constraint-backed; the L named beside each drop is the one that survives (no L here is itself dropped). The old
--      Worker only ever names columns, never an index name, so it is unaffected. The set was derived by replaying
--      api/migrations in order (CREATE/DROP INDEX, index and table renames incl. 0078's claw → agent_host, DROP COLUMN,
--      inline and ALTER constraints), not from the Drizzle schema. Tables served by the apps database, and any index
--      whose replay was ambiguous (created inside a to_regclass-guarded block before its table existed), are excluded.
--
-- REVERSIBLE: every dropped index is re-created by its original CREATE INDEX (the migration that created it is named in the comment beside the drop);
-- A holds no data (folded into artifact_likes by 1236). Tables that also exist in the operational track (tool_audit_daily) are
-- dropped here on the CORE copy only — transactional-migrations is a different database (see its own file for that track).


SET LOCAL lock_timeout = '3s';

-- ── A. Retired table: marketplace_skill_likes ────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS marketplace_skill_likes;

-- ── B. Prefix-redundant indexes (dropped index → surviving covering index) ────────────────────────────────────

-- artifact_assignments
DROP INDEX IF EXISTS idx_artifact_assignments_tenant;   -- (tenant_id, artifact_type) ⊂ artifact_assignments_pkey (tenant_id, artifact_type, artifact_slug, scope, scope_id)  [created 0020_artifact_assignments]

-- board_type_mappings
DROP INDEX IF EXISTS idx_board_type_mappings_conn;   -- (connection_id) ⊂ uq_board_type_mapping (connection_id, external_type)  [created 0256_platform_migration_staging]

-- candidate_demographics
DROP INDEX IF EXISTS idx_candidate_demographics_candidate;   -- (tenant_id, candidate_ref) ⊂ uq_candidate_demographics (tenant_id, candidate_ref, category)  [created 0460_hiring_consent_and_self_scheduling]

-- ceremony_participants
DROP INDEX IF EXISTS idx_ceremony_participants_session;   -- (session_id) ⊂ uq_ceremony_participant (session_id, member_kind, member_ref)  [created 0119_ceremony_sessions]

-- chat_memories
DROP INDEX IF EXISTS idx_chat_memories_tenant;   -- (tenant_id) ⊂ idx_chat_memories_project (tenant_id, project_id)  [created 0018_brain_chats_and_memories]

-- coaching_notes
DROP INDEX IF EXISTS idx_coaching_notes_tenant;   -- (tenant_id) ⊂ idx_coaching_notes_member (tenant_id, member_kind, member_ref)  [created 0311_coaching_notes]

-- contributors
DROP INDEX IF EXISTS idx_contributors_tenant;   -- (tenant_id) ⊂ idx_contributors_kind (tenant_id, kind)  [created 0068a_create_contributor_team_subsystem]

-- creation_outcome_events
DROP INDEX IF EXISTS idx_creation_outcomes_correlation;   -- (session_id, correlation_id) ⊂ uq_creation_outcomes_correlation_phase (session_id, correlation_id, action, phase)  [created 0404_creation_outcome_metrics]

-- customer_feedback
DROP INDEX IF EXISTS idx_customer_feedback_segment;   -- (segment_id, status) ⊂ idx_customer_feedback_segment_status (segment_id, status, created_at DESC)  [created 0071_cross_domain_seams]

-- dashboard_pins
DROP INDEX IF EXISTS idx_dashboard_pins_tenant_user;   -- (tenant_id, user_id) ⊂ dashboard_pins_tenant_id_user_id_widget_key_key (tenant_id, user_id, widget_key)  [created 0253_dashboard_pins]

-- devex_responses
DROP INDEX IF EXISTS idx_devex_responses_campaign;   -- (campaign_id) ⊂ idx_devex_responses_dedup (campaign_id, respondent_hash)  [created 0229_devex_surveys]

-- error_collector_integrations
DROP INDEX IF EXISTS idx_error_collector_integrations_collector;   -- (collector_id) ⊂ uq_collector_provider (collector_id, provider)  [created 0250_quality_collectors]

-- extension_packages
DROP INDEX IF EXISTS idx_extension_packages_listed;   -- (listing_state, kind) ⊂ idx_extension_packages_directory (listing_state, kind, install_count DESC)  [created 0467_developer_portal]

-- finops_soc_controls
DROP INDEX IF EXISTS idx_finops_soc_controls_tenant;   -- (tenant_id) ⊂ uq_finops_soc_controls_ref (tenant_id, control_ref)  [created 0254_finops_soc_controls_rename]

-- forecast_anomaly_acks
DROP INDEX IF EXISTS idx_forecast_anomaly_ack_metric;   -- (tenant_id, metric) ⊂ uq_forecast_anomaly_ack (tenant_id, metric, point_day)  [created 0305_forecast_anomaly_acks]

-- freelancer_reviews
DROP INDEX IF EXISTS idx_reviews_freelancer;   -- (freelancer_user_id) ⊂ idx_reviews_freelancer_dir (freelancer_user_id, direction)  [created 0273_freelance_two_sided]

-- import_staged_items
DROP INDEX IF EXISTS idx_import_staged_items_run;   -- (run_id) ⊂ uq_import_staged_item (run_id, external_id)  [created 0256_platform_migration_staging]

-- import_staged_projects
DROP INDEX IF EXISTS idx_import_staged_projects_run;   -- (run_id) ⊂ uq_import_staged_project (run_id, external_id)  [created 0256_platform_migration_staging]

-- import_staged_users
DROP INDEX IF EXISTS idx_import_staged_users_run;   -- (run_id) ⊂ uq_import_staged_user (run_id, external_id)  [created 0256_platform_migration_staging]

-- import_type_mappings
DROP INDEX IF EXISTS idx_import_type_mappings_run;   -- (run_id) ⊂ uq_import_type_mapping (run_id, external_type)  [created 0256_platform_migration_staging]

-- integration_credentials
DROP INDEX IF EXISTS idx_integration_credentials_tenant;   -- (tenant_id, provider) ⊂ uq_integration_tenant_provider_name (tenant_id, provider, name)  [created 0064_integration_credentials]

-- knowledge_acknowledgements
DROP INDEX IF EXISTS idx_knowledge_acks_doc;   -- (document_id) ⊂ uq_knowledge_acks (document_id, user_id)  [created 0227_knowledge_management]

-- knowledge_document_collaborators
DROP INDEX IF EXISTS idx_knowledge_collab_doc;   -- (document_id) ⊂ uq_knowledge_collab (document_id, user_id)  [created 0227_knowledge_management]

-- knowledge_document_tags
DROP INDEX IF EXISTS idx_knowledge_tags_doc;   -- (document_id) ⊂ uq_knowledge_tags (document_id, tag)  [created 0227_knowledge_management]

-- knowledge_training_assignments
DROP INDEX IF EXISTS idx_knowledge_training_doc;   -- (document_id) ⊂ uq_knowledge_training (document_id, user_id)  [created 0227_knowledge_management]

-- lens_snapshots
DROP INDEX IF EXISTS idx_lens_snapshots_tenant;   -- (tenant_id) ⊂ uq_lens_snapshot (tenant_id, lens, period)  [created 0309_lens_snapshots]

-- member_metrics_period
DROP INDEX IF EXISTS idx_mmp_tenant;   -- (tenant_id) ⊂ uq_member_metrics_period (tenant_id, member_kind, member_ref, period_start, period_end)  [created 0118_member_metrics_dora]

-- member_personas
DROP INDEX IF EXISTS idx_member_personas_tenant;   -- (tenant_id) ⊂ uq_member_persona (tenant_id, user_id, persona)  [created 0308_member_personas]
DROP INDEX IF EXISTS idx_member_personas_user;   -- (tenant_id, user_id) ⊂ uq_member_persona (tenant_id, user_id, persona)  [created 0308_member_personas]

-- member_profiles
DROP INDEX IF EXISTS idx_member_profiles_tenant;   -- (tenant_id) ⊂ uq_member_profile (tenant_id, member_kind, member_ref)  [created 0116_member_profiles]

-- privacy_requests
DROP INDEX IF EXISTS idx_privacy_requests_status;   -- (status) ⊂ privacy_requests_due_idx (status, due_at)  [created 0016_privacy_requests]

-- prod_incident_implicated_tasks
DROP INDEX IF EXISTS idx_incident_implicated_incident;   -- (incident_id) ⊂ uidx_incident_implicated_task (incident_id, task_id)  [created 0336_role_participation_phase3]

-- project_app_blueprints
DROP INDEX IF EXISTS idx_project_app_blueprints_project;   -- (project_id) ⊂ uq_project_app_blueprints_project_commit (project_id, commit_sha)  [created 1184_app_blueprint_storage]

-- project_fact_relations
DROP INDEX IF EXISTS idx_fact_relations_from;   -- (tenant_id, project_id, from_ref) ⊂ uq_fact_relation (tenant_id, project_id, from_ref, to_ref, kind)  [created 1278_knowledge_relations]

-- project_facts
DROP INDEX IF EXISTS idx_project_facts_project;   -- (tenant_id, project_id) ⊂ uq_project_facts (tenant_id, project_id, key)  [created 0276_project_facts]

-- project_game_targets
DROP INDEX IF EXISTS idx_project_game_targets_project;   -- (project_id) ⊂ uq_project_game_targets (project_id, slug, target)  [created 0416_game_targets]

-- project_secrets
DROP INDEX IF EXISTS idx_project_secrets_project;   -- (project_id) ⊂ uq_project_secrets_project_name (project_id, name)  [created 0411_challenge_backends]

-- prompt_library_entries
DROP INDEX IF EXISTS idx_prompt_entries_tenant;   -- (tenant_id) ⊂ uq_prompt_tenant_slug (tenant_id, slug)  [created 0069_activity_calendar_and_prompt_library]

-- prompt_library_versions
DROP INDEX IF EXISTS idx_prompt_versions_entry;   -- (entry_id) ⊂ uq_prompt_version (entry_id, version)  [created 0069_activity_calendar_and_prompt_library]

-- pulse_responses
DROP INDEX IF EXISTS idx_pulse_responses_survey;   -- (survey_id) ⊂ uq_pulse_response_user (survey_id, user_id)  [created 0317_pulse_surveys]

-- qa_findings
DROP INDEX IF EXISTS idx_qa_findings_exploration;   -- (exploration_id) ⊂ qa_findings_exploration_fingerprint_uniq (exploration_id, fingerprint)  [created 0206_agentic_tester]
DROP INDEX IF EXISTS idx_qa_findings_tenant_status;   -- (tenant_id, status) ⊂ idx_qa_findings_tenant_status_created (tenant_id, status, created_at)  [created 0206_agentic_tester]

-- rd_financials_quarterly
DROP INDEX IF EXISTS idx_rd_financials_fy;   -- (tenant_id, fiscal_year, quarter) ⊂ uq_rd_financials_cat (tenant_id, fiscal_year, quarter, category)  [created 0239_rd_financials_quarterly]

-- recommendation_dismissals
DROP INDEX IF EXISTS idx_recommendation_dismissals_tenant;   -- (tenant_id) ⊂ recommendation_dismissals_tenant_id_rec_key_key (tenant_id, rec_key)  [created 0232_recommendations_space]

-- role_permission_overrides
DROP INDEX IF EXISTS idx_rpo_role;   -- (role) ⊂ role_permission_overrides_role_permission_key (role, permission)  [created 0038_permissions_modules]

-- task_dependencies
DROP INDEX IF EXISTS idx_task_deps_predecessor;   -- (predecessor_task_id) ⊂ task_dependencies_unique_edge (predecessor_task_id, successor_task_id)  [created 0121_pm_visualizers]

-- task_specs
DROP INDEX IF EXISTS idx_task_specs_task;   -- (task_id) ⊂ uq_task_specs (task_id, spec_id)  [created 0098_task_specs_and_spec_status]

-- team_members
DROP INDEX IF EXISTS idx_team_members_team;   -- (team_id) ⊂ uq_team_member (team_id, member_kind, member_ref)  [created 0191_workforce_teams]

-- team_projects
DROP INDEX IF EXISTS idx_team_projects_team;   -- (team_id) ⊂ uq_team_project (team_id, project_id)  [created 0191_workforce_teams]

-- tenant_custom_roles
DROP INDEX IF EXISTS idx_tcr_tenant;   -- (tenant_id) ⊂ tenant_custom_roles_tenant_id_name_key (tenant_id, name)  [created 0038_permissions_modules]

-- tenant_member_modules
DROP INDEX IF EXISTS idx_tmm_tenant_user;   -- (tenant_id, user_id) ⊂ tenant_member_modules_tenant_id_user_id_module_id_key (tenant_id, user_id, module_id)  [created 0038_permissions_modules]

-- tenant_models
DROP INDEX IF EXISTS idx_tenant_models_tenant;   -- (tenant_id) ⊂ uq_tenant_models_slug (tenant_id, slug)  [created 0211_designer_repo_and_tenant_models]

-- ticket_role_signoffs
DROP INDEX IF EXISTS idx_role_signoffs_task;   -- (task_id) ⊂ idx_role_signoffs_task_role (task_id, role_key)  [created 0275_ticket_role_audit]

-- tool_audit_daily
DROP INDEX IF EXISTS idx_tool_audit_daily_tenant_day;   -- (tenant_id, day) ⊂ uq_tool_audit_daily_grain (tenant_id, day, tool_name, category, agent_host_id, cloud_agent_ref)  [created 1130_tool_audit_daily_rollup]

-- user_permission_overrides
DROP INDEX IF EXISTS idx_upo_tenant_user;   -- (tenant_id, user_id) ⊂ user_permission_overrides_tenant_id_user_id_permission_key (tenant_id, user_id, permission)  [created 0038_permissions_modules]

-- vscode_connections
-- (tenant_id) ⊂ uq_vscode_conn_user_machine (tenant_id, user_id, machine_name)  [created 0202_vscode_connections]
DROP INDEX IF EXISTS idx_vscode_conn_tenant;
