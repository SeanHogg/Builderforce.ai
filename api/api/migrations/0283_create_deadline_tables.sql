-- Migration: Create deadline and related tables (timelines & deadlines feature, task #278)
-- Tenant-scoped deadline tracking with business/customer classification, health status, dependencies, audit trail, and rollups

-- ---------------------------------------------------------------------------


-- Deadline tables (timeline & deadlines feature)


-- ---------------------------------------------------------------------------


-- Deadline records.
CREATE TABLE IF NOT EXISTS deadlines (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  title varchar(800) NOT NULL,
  type deadline_type NOT NULL,
  owner varchar(800) NOT NULL,
  due_date date NOT NULL,
  priority deadline_priority NOT NULL DEFAULT 'p3',
  tags varchar(4000)[] NOT NULL,
  description varchar(8000),
  -- IDs of dependents (deadlines that rely on this one). Stored as string[] for SQL array storage.
  dependents varchar(4000)[],
  -- Manual health override by admin; if present, status comes from this instead of auto-calc
  health_override deadline_status,
  health_override_reason varchar(8000),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_deadlines_tenant_id ON deadlines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deadlines_project_id ON deadlines(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deadlines_type ON deadlines(type);
CREATE INDEX IF NOT EXISTS idx_deadlines_status ON deadlines(health_override) WHERE health_override IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deadlines_due_date ON deadlines(due_date);
CREATE INDEX IF NOT EXISTS idx_deadlines_owner ON deadlines(owner);

-- Directed dependency edges: fromDeadlineId BLOCKS toDeadlineId (feeds the critical path).
CREATE TABLE IF NOT EXISTS deadline_dependencies (
  id bigserial PRIMARY KEY,
  from_deadline_id bigint NOT NULL REFERENCES deadlines(id) ON DELETE CASCADE,
  to_deadline_id bigint NOT NULL REFERENCES deadlines(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT deadline_dependencies_unique UNIQUE (from_deadline_id, to_deadline_id)
);

CREATE INDEX IF NOT EXISTS idx_deadline_dependencies_from ON deadline_dependencies(from_deadline_id);
CREATE INDEX IF NOT EXISTS idx_deadline_dependencies_to ON deadline_dependencies(to_deadline_id);

-- Audit trail for changes to deadlines (date moves, health overrides, tags, etc.).
CREATE TABLE IF NOT EXISTS deadline_audit (
  id bigserial PRIMARY KEY,
  deadline_id bigint NOT NULL REFERENCES deadlines(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- System-run identifier; optional
  run_id bigint,
  -- Field changed (e.g., 'dueDate', 'healthOverride', 'title', 'owner').
  field_changed varchar(80) NOT NULL,
  previous_value varchar(8000),
  new_value varchar(8000),
  slip_reason varchar(800),
  actor varchar(800),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deadline_audit_deadline_id ON deadline_audit(deadline_id);
CREATE INDEX IF NOT EXISTS idx_deadline_audit_tenant_id ON deadline_audit(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deadline_audit_run_id ON deadline_audit(run_id) WHERE run_id IS NOT NULL;

-- Per-deadline daily rollup metrics.
CREATE TABLE IF NOT EXISTS deadline_rollups (
  id bigserial PRIMARY KEY,
  deadline_id bigint NOT NULL REFERENCES deadlines(id) ON DELETE CASCADE,
  run_id bigint NOT NULL,
  period_begin date NOT NULL,
  period_end date NOT NULL,
  slip_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT deadline_rollups_unique UNIQUE (deadline_id, run_id, period_begin, period_end)
);


-- ---------------------------------------------------------------------------

-- Configure a default deadline table schema version for admin caller use.
CREATE OR REPLACE FUNCTION get_deadline_table_schema_version() RETURNS text IMMUTABLE AS $$
BEGIN
  RETURN '0283_create_deadline_tables';
END;
$$ LANGUAGE plpgsql;

-- Admin caller may read or update this version. This documents what configurations
-- (Table columns, Enum values, and Extensions) are present.