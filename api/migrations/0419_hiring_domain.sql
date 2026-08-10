-- 0419_hiring_domain.sql
--
-- Hiring domain
--
-- GENERATED from src/infrastructure/database/schema/hiring.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 23 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS job_applications (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  job_posting_id INTEGER,
  candidate_ref VARCHAR(64) NOT NULL,
  source VARCHAR(48) NOT NULL DEFAULT 'direct',
  status VARCHAR(48) NOT NULL DEFAULT 'applied',
  cover_letter TEXT,
  resume_ref UUID,
  score NUMERIC(5, 2),
  rejected_at TIMESTAMP,
  reject_reason VARCHAR(160),
  applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_applications_candidate ON job_applications (tenant_id, job_posting_id, candidate_ref);
CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications (tenant_id, status, applied_at);

CREATE TABLE IF NOT EXISTS candidate_resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL,
  candidate_ref VARCHAR(64) NOT NULL,
  artifact_id UUID,
  headline VARCHAR(300),
  parsed JSONB,
  skills JSONB,
  years_exp NUMERIC(4, 1),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  parsed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_candidate_resumes_candidate ON candidate_resumes (tenant_id, candidate_ref, is_primary);

CREATE TABLE IF NOT EXISTS candidate_interactions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  candidate_ref VARCHAR(64) NOT NULL,
  channel VARCHAR(24) NOT NULL,
  direction VARCHAR(12) NOT NULL DEFAULT 'outbound',
  actor_ref VARCHAR(64),
  subject VARCHAR(300),
  body TEXT,
  outcome VARCHAR(48),
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_candidate_interactions_candidate ON candidate_interactions (tenant_id, candidate_ref, occurred_at);

CREATE TABLE IF NOT EXISTS job_pipeline_entries (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  application_id INTEGER,
  candidate_ref VARCHAR(64) NOT NULL,
  pipeline_ref VARCHAR(64) NOT NULL,
  stage VARCHAR(48) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  entered_at TIMESTAMP NOT NULL DEFAULT NOW(),
  exited_at TIMESTAMP,
  days_in_stage INTEGER,
  owner_ref VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_pipeline_entries_stage ON job_pipeline_entries (tenant_id, pipeline_ref, stage, position);

CREATE TABLE IF NOT EXISTS interview_kits (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  role_family VARCHAR(96),
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_kits_name ON interview_kits (tenant_id, name);

CREATE TABLE IF NOT EXISTS interview_kit_stages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  kit_id INTEGER REFERENCES interview_kits(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  kind VARCHAR(32) NOT NULL DEFAULT 'screen',
  position INTEGER NOT NULL DEFAULT 0,
  duration_min INTEGER,
  scorecard_id UUID,
  guidance TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_kit_stages_pos ON interview_kit_stages (kit_id, position);

CREATE TABLE IF NOT EXISTS interviews (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  application_id INTEGER,
  kit_stage_id INTEGER,
  candidate_ref VARCHAR(64) NOT NULL,
  scheduled_at TIMESTAMP,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'scheduled',
  mode VARCHAR(12) NOT NULL DEFAULT 'live',
  meeting_url TEXT,
  recording_id UUID,
  overall_score NUMERIC(5, 2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_interviews_schedule ON interviews (tenant_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_interviews_candidate ON interviews (tenant_id, candidate_ref);

CREATE TABLE IF NOT EXISTS interview_question_sets (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  role_family VARCHAR(96),
  seniority VARCHAR(32),
  questions JSONB NOT NULL DEFAULT '[]',
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_question_sets_name ON interview_question_sets (tenant_id, name);

CREATE TABLE IF NOT EXISTS scorecard_attributes (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  scorecard_id UUID,
  key VARCHAR(96) NOT NULL,
  label VARCHAR(200) NOT NULL,
  weight NUMERIC(5, 2) NOT NULL DEFAULT '1',
  scale_min INTEGER NOT NULL DEFAULT 1,
  scale_max INTEGER NOT NULL DEFAULT 5,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scorecard_attributes_key ON scorecard_attributes (tenant_id, scorecard_id, key);

CREATE TABLE IF NOT EXISTS screening_template_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  template_id UUID,
  prompt TEXT NOT NULL,
  answer_type VARCHAR(16) NOT NULL DEFAULT 'text',
  choices JSONB,
  knockout JSONB,
  required BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_screening_template_items_pos ON screening_template_items (template_id, position);

CREATE TABLE IF NOT EXISTS hiring_decisions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  application_id INTEGER,
  candidate_ref VARCHAR(64) NOT NULL,
  decision VARCHAR(24) NOT NULL,
  decider_ref VARCHAR(64),
  rationale TEXT,
  evidence JSONB,
  decided_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hiring_decisions_application ON hiring_decisions (application_id, decided_at);

CREATE TABLE IF NOT EXISTS offer_letters (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  application_id INTEGER,
  candidate_ref VARCHAR(64) NOT NULL,
  title VARCHAR(200) NOT NULL,
  base_salary NUMERIC(14, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  equity VARCHAR(96),
  start_date TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  expires_at TIMESTAMP,
  sent_at TIMESTAMP,
  responded_at TIMESTAMP,
  terms JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_offer_letters_status ON offer_letters (tenant_id, status, sent_at);

CREATE TABLE IF NOT EXISTS placements (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  candidate_ref VARCHAR(64) NOT NULL,
  client_ref VARCHAR(64),
  job_posting_id INTEGER,
  kind VARCHAR(24) NOT NULL DEFAULT 'permanent',
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  salary NUMERIC(14, 2),
  fee_percent NUMERIC(5, 2),
  fee_amount NUMERIC(14, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  guarantee_ends_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_placements_status ON placements (tenant_id, status, start_date);

CREATE TABLE IF NOT EXISTS placement_splits (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  placement_id INTEGER REFERENCES placements(id) ON DELETE CASCADE,
  party_kind VARCHAR(16) NOT NULL DEFAULT 'user',
  party_ref VARCHAR(64) NOT NULL,
  role VARCHAR(24) NOT NULL,
  percent NUMERIC(5, 2) NOT NULL,
  amount NUMERIC(14, 2),
  settled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_placement_splits_party ON placement_splits (placement_id, party_kind, party_ref, role);

CREATE TABLE IF NOT EXISTS placement_documents (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  placement_id INTEGER REFERENCES placements(id) ON DELETE CASCADE,
  kind VARCHAR(48) NOT NULL,
  artifact_id UUID,
  status VARCHAR(16) NOT NULL DEFAULT 'required',
  expires_at TIMESTAMP,
  verified_by VARCHAR(64),
  verified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_placement_documents_kind ON placement_documents (placement_id, kind);

CREATE TABLE IF NOT EXISTS outplacement_packages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  duration_days INTEGER NOT NULL DEFAULT 90,
  entitlements JSONB,
  seat_count INTEGER NOT NULL DEFAULT 0,
  seats_used INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_outplacement_packages_name ON outplacement_packages (tenant_id, name);

CREATE TABLE IF NOT EXISTS retained_search_firms (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  contact_email VARCHAR(320),
  fee_percent NUMERIC(5, 2),
  retainer_amount NUMERIC(14, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  specialisms JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_retained_search_firms_name ON retained_search_firms (tenant_id, name);

CREATE TABLE IF NOT EXISTS recruiter_outreach_sequences (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]',
  audience JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  owner_ref VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recruiter_outreach_sequences_name ON recruiter_outreach_sequences (tenant_id, name);

CREATE TABLE IF NOT EXISTS recruiter_agent_followups (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  candidate_ref VARCHAR(64),
  application_id INTEGER,
  reason VARCHAR(160) NOT NULL,
  due_at TIMESTAMP NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  draft TEXT,
  sent_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recruiter_agent_followups_due ON recruiter_agent_followups (tenant_id, status, due_at);

CREATE TABLE IF NOT EXISTS job_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  job_posting_id INTEGER,
  kind VARCHAR(24) NOT NULL,
  body TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_items_posting ON job_items (job_posting_id, kind, position);

CREATE TABLE IF NOT EXISTS job_websites (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  slug VARCHAR(120) NOT NULL,
  name VARCHAR(200) NOT NULL,
  domain VARCHAR(255),
  theme JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_websites_slug ON job_websites (tenant_id, slug);

CREATE TABLE IF NOT EXISTS ramp_times (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  role_family VARCHAR(96) NOT NULL,
  seniority VARCHAR(32),
  definition TEXT,
  target_days INTEGER,
  actual_days NUMERIC(6, 1),
  sample_size INTEGER NOT NULL DEFAULT 0,
  measured_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ramp_times_role ON ramp_times (tenant_id, role_family, seniority, measured_at);

CREATE TABLE IF NOT EXISTS cohort_retention (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  cohort_key VARCHAR(64) NOT NULL,
  cohort_started_at TIMESTAMP NOT NULL,
  period_days INTEGER NOT NULL,
  starting_count INTEGER NOT NULL,
  retained_count INTEGER NOT NULL,
  retention_rate NUMERIC(5, 2),
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cohort_retention_point ON cohort_retention (tenant_id, cohort_key, period_days);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE job_applications DROP CONSTRAINT IF EXISTS fk_job_applications_tenant;
ALTER TABLE job_applications ADD CONSTRAINT fk_job_applications_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE candidate_resumes DROP CONSTRAINT IF EXISTS fk_candidate_resumes_tenant;
ALTER TABLE candidate_resumes ADD CONSTRAINT fk_candidate_resumes_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE candidate_interactions DROP CONSTRAINT IF EXISTS fk_candidate_interactions_tenant;
ALTER TABLE candidate_interactions ADD CONSTRAINT fk_candidate_interactions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE job_pipeline_entries DROP CONSTRAINT IF EXISTS fk_job_pipeline_entries_tenant;
ALTER TABLE job_pipeline_entries ADD CONSTRAINT fk_job_pipeline_entries_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE interview_kits DROP CONSTRAINT IF EXISTS fk_interview_kits_tenant;
ALTER TABLE interview_kits ADD CONSTRAINT fk_interview_kits_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE interview_kit_stages DROP CONSTRAINT IF EXISTS fk_interview_kit_stages_tenant;
ALTER TABLE interview_kit_stages ADD CONSTRAINT fk_interview_kit_stages_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE interviews DROP CONSTRAINT IF EXISTS fk_interviews_tenant;
ALTER TABLE interviews ADD CONSTRAINT fk_interviews_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE interview_question_sets DROP CONSTRAINT IF EXISTS fk_interview_question_sets_tenant;
ALTER TABLE interview_question_sets ADD CONSTRAINT fk_interview_question_sets_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE scorecard_attributes DROP CONSTRAINT IF EXISTS fk_scorecard_attributes_tenant;
ALTER TABLE scorecard_attributes ADD CONSTRAINT fk_scorecard_attributes_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE screening_template_items DROP CONSTRAINT IF EXISTS fk_screening_template_items_tenant;
ALTER TABLE screening_template_items ADD CONSTRAINT fk_screening_template_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE hiring_decisions DROP CONSTRAINT IF EXISTS fk_hiring_decisions_tenant;
ALTER TABLE hiring_decisions ADD CONSTRAINT fk_hiring_decisions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE offer_letters DROP CONSTRAINT IF EXISTS fk_offer_letters_tenant;
ALTER TABLE offer_letters ADD CONSTRAINT fk_offer_letters_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE placements DROP CONSTRAINT IF EXISTS fk_placements_tenant;
ALTER TABLE placements ADD CONSTRAINT fk_placements_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE placement_splits DROP CONSTRAINT IF EXISTS fk_placement_splits_tenant;
ALTER TABLE placement_splits ADD CONSTRAINT fk_placement_splits_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE placement_documents DROP CONSTRAINT IF EXISTS fk_placement_documents_tenant;
ALTER TABLE placement_documents ADD CONSTRAINT fk_placement_documents_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE outplacement_packages DROP CONSTRAINT IF EXISTS fk_outplacement_packages_tenant;
ALTER TABLE outplacement_packages ADD CONSTRAINT fk_outplacement_packages_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE retained_search_firms DROP CONSTRAINT IF EXISTS fk_retained_search_firms_tenant;
ALTER TABLE retained_search_firms ADD CONSTRAINT fk_retained_search_firms_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE recruiter_outreach_sequences DROP CONSTRAINT IF EXISTS fk_recruiter_outreach_sequences_tenant;
ALTER TABLE recruiter_outreach_sequences ADD CONSTRAINT fk_recruiter_outreach_sequences_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE recruiter_agent_followups DROP CONSTRAINT IF EXISTS fk_recruiter_agent_followups_tenant;
ALTER TABLE recruiter_agent_followups ADD CONSTRAINT fk_recruiter_agent_followups_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE job_items DROP CONSTRAINT IF EXISTS fk_job_items_tenant;
ALTER TABLE job_items ADD CONSTRAINT fk_job_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE job_websites DROP CONSTRAINT IF EXISTS fk_job_websites_tenant;
ALTER TABLE job_websites ADD CONSTRAINT fk_job_websites_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ramp_times DROP CONSTRAINT IF EXISTS fk_ramp_times_tenant;
ALTER TABLE ramp_times ADD CONSTRAINT fk_ramp_times_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE cohort_retention DROP CONSTRAINT IF EXISTS fk_cohort_retention_tenant;
ALTER TABLE cohort_retention ADD CONSTRAINT fk_cohort_retention_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
