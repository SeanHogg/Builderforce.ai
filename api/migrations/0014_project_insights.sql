-- Project insight events: track project-scoped code changes and aggregate at tenant level
CREATE TABLE project_insight_events (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  execution_id INTEGER REFERENCES executions(id) ON DELETE SET NULL,
  code_changes INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX project_insight_events_tenant_id_idx ON project_insight_events(tenant_id);
CREATE INDEX project_insight_events_project_id_idx ON project_insight_events(project_id);
CREATE INDEX project_insight_events_created_at_idx ON project_insight_events(created_at);
