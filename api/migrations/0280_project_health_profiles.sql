-- 0280_project_health_profiles.sql
-- Health Profile Persistence — structure health questionnaire answers as a
-- canonical Health Profile attached to a project. Tracks versions with immutable
-- snapshots. Foreign-key on projects(id) with CASCADE DELETE.
--
-- Idempotent / re-runnable: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS health_profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id   integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  schema_version varchar(16) NOT NULL DEFAULT '1.0', -- matches canonical schema version
  demographics jsonb NOT NULL, -- e.g., {name, dob, email}
  medical_history jsonb NOT NULL, -- e.g., {conditions, surgeries}
  current_symptoms jsonb NOT NULL, -- e.g., {list, severity}
  medications jsonb NOT NULL, -- e.g., [{name, dosage, rx_number}]
  lifestyle jsonb NOT NULL, -- e.g., {exercise, smoking, alcohol}
  custom_fields jsonb NOT NULL DEFAULT '{}', -- unknown question keys go here
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now(),
  actor_ref    varchar(64) NOT NULL, -- users.id (UUID) of the actor who made this version
  CONSTRAINT uq_project_health_profile UNIQUE (tenant_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_health_profiles_project ON health_profiles (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_health_profiles_tenant ON health_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_health_profiles_actor ON health_profiles (actor_ref);

CREATE TABLE IF NOT EXISTS health_profile_versions (
  version_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id   integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_seq  integer NOT NULL, -- sequential version number (1, 2, 3...)
  actor_ref    varchar(64) NOT NULL, -- users.id (UUID) of the actor who made this version
  content      jsonb NOT NULL,   -- full JSON snapshot
  created_at   timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_health_profile_version UNIQUE (tenant_id, project_id, version_seq)
);

CREATE INDEX IF NOT EXISTS idx_health_profile_versions_project ON health_profile_versions (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_health_profile_versions_tenant ON health_profile_versions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_health_profile_versions_seq ON health_profile_versions (tenant_id, project_id, version_seq);