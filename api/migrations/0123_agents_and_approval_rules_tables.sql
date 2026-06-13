-- Migration: create the `agents` and `approval_rules` tables.
--
-- Both are declared in schema.ts and queried at runtime, but were only ever
-- materialised via the `drizzle-kit push` baseline — no tracked migration
-- created them (the last two such tables; telemetry_spans was the prior one,
-- fixed in 0073). A migration-only environment (e.g. production) therefore
-- never gets them and crashes the moment they're queried — the identical
-- "relation does not exist" risk 0073 closed. This converges every environment.
--
-- Same template as 0073: IF NOT EXISTS for idempotency over the push baseline,
-- and a second step that replays 0056's segment_id column + default-fill trigger
-- + NOT NULL + index (0056 runs first and skips these tables via its
-- to_regclass guard when absent). set_default_segment_id() is defined in 0056.

-- agents.type uses the `agent_type` enum (also push-baseline-created); guard it
-- so a fresh migration-only DB can create the table.
DO $$ BEGIN
  CREATE TYPE agent_type AS ENUM ('claude', 'openai', 'ollama', 'http');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS agents (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  type          agent_type NOT NULL,
  endpoint      VARCHAR(500) NOT NULL,
  api_key_hash  VARCHAR(64),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  config        TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);

CREATE TABLE IF NOT EXISTS approval_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  action_type         VARCHAR(255),
  max_estimated_cost  INTEGER,
  max_files_changed   INTEGER,
  is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_approval_rules_tenant ON approval_rules(tenant_id);

-- segment_id propagation — mirrors 0056 (which skipped these tables when absent).
-- Order per 0073: ADD COLUMN -> CREATE TRIGGER -> backfill -> SET NOT NULL.
DO $$ BEGIN
  IF to_regclass('public.agents') IS NOT NULL THEN
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_agents_segment ON agents;
    CREATE TRIGGER trg_agents_segment BEFORE INSERT ON agents FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE agents x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE agents ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_agents_segment ON agents(segment_id);
  END IF;
  IF to_regclass('public.approval_rules') IS NOT NULL THEN
    ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_approval_rules_segment ON approval_rules;
    CREATE TRIGGER trg_approval_rules_segment BEFORE INSERT ON approval_rules FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE approval_rules x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE approval_rules ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_approval_rules_segment ON approval_rules(segment_id);
  END IF;
END $$;
