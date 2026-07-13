-- 0258_project_evermind.sql
-- Per-project Evermind model pointer.
--
-- The canonical, LEARNABLE project model lives in R2 (UPLOADS) as versioned,
-- immutable objects under:
--   evermind/project/<tenantId>/<projectId>/v<version>/model.evermind
--   evermind/project/<tenantId>/<projectId>/v<version>/tokenizer.json
-- This row is the single source of truth for the CURRENT version + learning mode.
-- The ProjectEvermindCoordinator Durable Object (keyed proj:<tenantId>:<projectId>)
-- is the ONLY writer: it serializes concurrent learning pushes, merges weight
-- deltas (FedAvg), republishes the next version to R2, and bumps `version` here.
-- Every surface (cloud / on-prem / IDE) reads the current version and runs a local
-- replica; the immutable per-version ref keeps every read coherent.
CREATE TABLE IF NOT EXISTS project_evermind (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Carried into the .evermind manifest name on each republish.
  name            TEXT NOT NULL DEFAULT 'Project Evermind',
  -- Current canonical version (monotonic). 0 = not yet seeded (no model in R2).
  version         INTEGER NOT NULL DEFAULT 0,
  -- 'connected' (pull latest + contribute) | 'offline-frozen' (pinned, no write-back).
  mode            VARCHAR(16) NOT NULL DEFAULT 'connected',
  -- Total merged learning contributions applied across this model's life (telemetry).
  contributions   INTEGER NOT NULL DEFAULT 0,
  -- Last time a learning delta merged in (cooldown / cost-guard reference).
  last_learned_at TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_evermind_project
  ON project_evermind(tenant_id, project_id);
