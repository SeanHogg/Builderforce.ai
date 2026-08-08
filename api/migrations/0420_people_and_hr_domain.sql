-- 0420_people_and_hr_domain.sql
--
-- People and HR domain
--
-- GENERATED from src/infrastructure/database/schema/people.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 22 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS people_employees (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  party_ref VARCHAR(64) NOT NULL,
  employee_code VARCHAR(48),
  title VARCHAR(200),
  department VARCHAR(120),
  manager_ref VARCHAR(64),
  location VARCHAR(120),
  employment VARCHAR(24) NOT NULL DEFAULT 'full_time',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_people_employees_party ON people_employees (tenant_id, party_ref);
CREATE INDEX IF NOT EXISTS idx_people_employees_manager ON people_employees (tenant_id, manager_ref, status);

CREATE TABLE IF NOT EXISTS hr_employment_records (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  employee_id INTEGER REFERENCES people_employees(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,
  effective_at TIMESTAMP NOT NULL,
  previous JSONB,
  next JSONB,
  reason TEXT,
  approved_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hr_employment_records_employee ON hr_employment_records (employee_id, effective_at);

CREATE TABLE IF NOT EXISTS hr_emergency_contacts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  employee_id INTEGER REFERENCES people_employees(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  relationship VARCHAR(64),
  phone VARCHAR(40),
  email VARCHAR(320),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hr_emergency_contacts_employee ON hr_emergency_contacts (employee_id, is_primary);

CREATE TABLE IF NOT EXISTS people_tenants (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  legal_name VARCHAR(255) NOT NULL,
  country VARCHAR(2),
  payroll_ref VARCHAR(96),
  fiscal_start INTEGER NOT NULL DEFAULT 1,
  policies JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_people_tenants_legal ON people_tenants (tenant_id, legal_name);

CREATE TABLE IF NOT EXISTS people_headcount_plans (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  period VARCHAR(24) NOT NULL,
  department VARCHAR(120),
  planned_heads INTEGER NOT NULL DEFAULT 0,
  actual_heads INTEGER NOT NULL DEFAULT 0,
  budget NUMERIC(16, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_people_headcount_plans_period ON people_headcount_plans (tenant_id, name, period);

CREATE TABLE IF NOT EXISTS headcount_impacts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  plan_id INTEGER REFERENCES people_headcount_plans(id) ON DELETE CASCADE,
  kind VARCHAR(24) NOT NULL,
  head_delta INTEGER NOT NULL,
  cost_delta NUMERIC(16, 2),
  effective_at TIMESTAMP NOT NULL,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_headcount_impacts_plan ON headcount_impacts (plan_id, effective_at);

CREATE TABLE IF NOT EXISTS people_objective_outcomes (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  employee_id INTEGER REFERENCES people_employees(id) ON DELETE CASCADE,
  work_item_ref VARCHAR(64),
  period VARCHAR(24) NOT NULL,
  rating NUMERIC(4, 2),
  narrative TEXT,
  calibrated_by VARCHAR(64),
  finalised_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_people_objective_outcomes_period ON people_objective_outcomes (employee_id, work_item_ref, period);

CREATE TABLE IF NOT EXISTS people_workflow_triggers (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  event VARCHAR(48) NOT NULL,
  conditions JSONB,
  actions JSONB NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_fired_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_people_workflow_triggers_name ON people_workflow_triggers (tenant_id, name);

CREATE TABLE IF NOT EXISTS health_dimensions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  key VARCHAR(64) NOT NULL,
  label VARCHAR(200) NOT NULL,
  description TEXT,
  weight NUMERIC(5, 2) NOT NULL DEFAULT '1',
  benchmark NUMERIC(5, 2),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_health_dimensions_key ON health_dimensions (tenant_id, key);

CREATE TABLE IF NOT EXISTS competencies (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  key VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(64),
  description TEXT,
  levels JSONB,
  role_families JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_competencies_key ON competencies (tenant_id, key);

CREATE TABLE IF NOT EXISTS badges (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  key VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  icon_key VARCHAR(96),
  kind VARCHAR(32) NOT NULL DEFAULT 'achievement',
  criteria JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_badges_key ON badges (tenant_id, key);

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  slug VARCHAR(160) NOT NULL,
  title VARCHAR(300) NOT NULL,
  summary TEXT,
  level VARCHAR(24),
  duration_min INTEGER,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  price_cents INTEGER,
  currency VARCHAR(8),
  author_ref VARCHAR(64),
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_courses_slug ON courses (tenant_id, slug);

CREATE TABLE IF NOT EXISTS course_modules (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  summary TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_modules_pos ON course_modules (course_id, position);

CREATE TABLE IF NOT EXISTS course_lessons (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  module_id INTEGER REFERENCES course_modules(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  kind VARCHAR(24) NOT NULL DEFAULT 'reading',
  body TEXT,
  artifact_id UUID,
  duration_min INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_lessons_pos ON course_lessons (module_id, position);

CREATE TABLE IF NOT EXISTS course_enrollments (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  path_ref VARCHAR(64),
  learner_ref VARCHAR(64) NOT NULL,
  cohort_id INTEGER,
  status VARCHAR(16) NOT NULL DEFAULT 'enrolled',
  progress NUMERIC(5, 2) NOT NULL DEFAULT '0',
  enrolled_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  due_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_enrollments_learner ON course_enrollments (tenant_id, course_id, learner_ref);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_status ON course_enrollments (tenant_id, status, due_at);

CREATE TABLE IF NOT EXISTS learning_cohorts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  starts_at TIMESTAMP,
  ends_at TIMESTAMP,
  seat_limit INTEGER,
  facilitator_ref VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_learning_cohorts_course ON learning_cohorts (tenant_id, course_id, starts_at);

CREATE TABLE IF NOT EXISTS course_certificates (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  enrollment_id INTEGER REFERENCES course_enrollments(id) ON DELETE CASCADE,
  learner_ref VARCHAR(64) NOT NULL,
  serial VARCHAR(64) NOT NULL,
  artifact_id UUID,
  issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_certificates_serial ON course_certificates (serial);

CREATE TABLE IF NOT EXISTS course_checkouts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  buyer_ref VARCHAR(64),
  email VARCHAR(320),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(16) NOT NULL DEFAULT 'started',
  provider_ref VARCHAR(160),
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_course_checkouts_status ON course_checkouts (tenant_id, status, created_at);

CREATE TABLE IF NOT EXISTS lms_connectors (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  connection_id INTEGER,
  standard VARCHAR(16) NOT NULL,
  endpoint TEXT,
  default_course_folder VARCHAR(255),
  config JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lms_connectors_tenant ON lms_connectors (tenant_id, standard, status);

CREATE TABLE IF NOT EXISTS lms_course_publishes (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  connector_id INTEGER REFERENCES lms_connectors(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  external_id VARCHAR(160),
  version VARCHAR(24) NOT NULL DEFAULT '1',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  published_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_course_publishes_target ON lms_course_publishes (connector_id, course_id);

CREATE TABLE IF NOT EXISTS scorm_cmi_states (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  enrollment_id INTEGER REFERENCES course_enrollments(id) ON DELETE CASCADE,
  lesson_id INTEGER,
  learner_ref VARCHAR(64) NOT NULL,
  cmi JSONB NOT NULL DEFAULT '{}',
  lesson_status VARCHAR(24),
  score_raw NUMERIC(6, 2),
  total_time_sec INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scorm_cmi_states_learner ON scorm_cmi_states (enrollment_id, lesson_id, learner_ref);

CREATE TABLE IF NOT EXISTS lrs_documents (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  scope VARCHAR(24) NOT NULL,
  activity_id VARCHAR(320),
  agent_key VARCHAR(320),
  registration VARCHAR(64),
  document_id VARCHAR(255) NOT NULL,
  content_type VARCHAR(128),
  content JSONB,
  etag VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lrs_documents_key ON lrs_documents (tenant_id, scope, activity_id, agent_key, document_id);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE people_employees DROP CONSTRAINT IF EXISTS fk_people_employees_tenant;
ALTER TABLE people_employees ADD CONSTRAINT fk_people_employees_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE hr_employment_records DROP CONSTRAINT IF EXISTS fk_hr_employment_records_tenant;
ALTER TABLE hr_employment_records ADD CONSTRAINT fk_hr_employment_records_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE hr_emergency_contacts DROP CONSTRAINT IF EXISTS fk_hr_emergency_contacts_tenant;
ALTER TABLE hr_emergency_contacts ADD CONSTRAINT fk_hr_emergency_contacts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE people_tenants DROP CONSTRAINT IF EXISTS fk_people_tenants_tenant;
ALTER TABLE people_tenants ADD CONSTRAINT fk_people_tenants_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE people_headcount_plans DROP CONSTRAINT IF EXISTS fk_people_headcount_plans_tenant;
ALTER TABLE people_headcount_plans ADD CONSTRAINT fk_people_headcount_plans_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE headcount_impacts DROP CONSTRAINT IF EXISTS fk_headcount_impacts_tenant;
ALTER TABLE headcount_impacts ADD CONSTRAINT fk_headcount_impacts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE people_objective_outcomes DROP CONSTRAINT IF EXISTS fk_people_objective_outcomes_tenant;
ALTER TABLE people_objective_outcomes ADD CONSTRAINT fk_people_objective_outcomes_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE people_workflow_triggers DROP CONSTRAINT IF EXISTS fk_people_workflow_triggers_tenant;
ALTER TABLE people_workflow_triggers ADD CONSTRAINT fk_people_workflow_triggers_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE health_dimensions DROP CONSTRAINT IF EXISTS fk_health_dimensions_tenant;
ALTER TABLE health_dimensions ADD CONSTRAINT fk_health_dimensions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE competencies DROP CONSTRAINT IF EXISTS fk_competencies_tenant;
ALTER TABLE competencies ADD CONSTRAINT fk_competencies_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE badges DROP CONSTRAINT IF EXISTS fk_badges_tenant;
ALTER TABLE badges ADD CONSTRAINT fk_badges_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE courses DROP CONSTRAINT IF EXISTS fk_courses_tenant;
ALTER TABLE courses ADD CONSTRAINT fk_courses_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE course_modules DROP CONSTRAINT IF EXISTS fk_course_modules_tenant;
ALTER TABLE course_modules ADD CONSTRAINT fk_course_modules_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE course_lessons DROP CONSTRAINT IF EXISTS fk_course_lessons_tenant;
ALTER TABLE course_lessons ADD CONSTRAINT fk_course_lessons_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE course_enrollments DROP CONSTRAINT IF EXISTS fk_course_enrollments_tenant;
ALTER TABLE course_enrollments ADD CONSTRAINT fk_course_enrollments_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE learning_cohorts DROP CONSTRAINT IF EXISTS fk_learning_cohorts_tenant;
ALTER TABLE learning_cohorts ADD CONSTRAINT fk_learning_cohorts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE course_certificates DROP CONSTRAINT IF EXISTS fk_course_certificates_tenant;
ALTER TABLE course_certificates ADD CONSTRAINT fk_course_certificates_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE course_checkouts DROP CONSTRAINT IF EXISTS fk_course_checkouts_tenant;
ALTER TABLE course_checkouts ADD CONSTRAINT fk_course_checkouts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE lms_connectors DROP CONSTRAINT IF EXISTS fk_lms_connectors_tenant;
ALTER TABLE lms_connectors ADD CONSTRAINT fk_lms_connectors_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE lms_course_publishes DROP CONSTRAINT IF EXISTS fk_lms_course_publishes_tenant;
ALTER TABLE lms_course_publishes ADD CONSTRAINT fk_lms_course_publishes_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE scorm_cmi_states DROP CONSTRAINT IF EXISTS fk_scorm_cmi_states_tenant;
ALTER TABLE scorm_cmi_states ADD CONSTRAINT fk_scorm_cmi_states_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE lrs_documents DROP CONSTRAINT IF EXISTS fk_lrs_documents_tenant;
ALTER TABLE lrs_documents ADD CONSTRAINT fk_lrs_documents_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
