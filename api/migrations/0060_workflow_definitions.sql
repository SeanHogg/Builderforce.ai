-- Migration: Workflow Definitions — reusable, visually-authored agentic
-- workflow graphs (the IPAAS-style drag-and-drop builder).
--
-- A *definition* is the design-time template the builder canvas serializes to:
-- a graph of nodes (triggers, ETL ops, and LLM-logic nodes — memory, knowledge
-- base, training — plus agent-run nodes) and the edges wiring them. At run time
-- a definition is compiled to orchestrator steps and instantiated as a regular
-- `workflows` execution record, so it shows up in the existing monitoring +
-- telemetry-graph surfaces with zero extra plumbing.
--
-- (tenant_id, segment_id)-scoped via the 0056 default-segment trigger.

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  -- Serialized WorkflowDefinition: {"nodes":[...],"edges":[...]}. Stored as TEXT
  -- (JSON) to match the codebase convention for graph/array columns.
  definition  TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_workflow_definitions_segment ON workflow_definitions;
CREATE TRIGGER trg_workflow_definitions_segment
  BEFORE INSERT ON workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_segment
  ON workflow_definitions(tenant_id, segment_id);
