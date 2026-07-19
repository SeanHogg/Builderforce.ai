-- 0348_policy_packs.sql
--
-- The POLICY-PACK STORE — the missing authoring surface behind the already-shipped
-- `PolicyGate` enforcement.
--
-- `evaluatePolicyGate` (packages/agent-tools/src/spec.ts) is hard-enforced at three
-- tool-call seams (cloud engine, VS Code agent, on-prem relay) and gates reach a run
-- via the run payload's `policyGates`. But nothing ever WROTE gates: there was no
-- table, no CRUD, no resolver — so `policyGates` was `[]` on every real run and the
-- enforcement machinery was dead-ended. This adds the store.
--
-- Two tables, deliberately mirroring the wire type so no translation layer is needed:
--
--   policy_packs — a tenant-scoped, named, toggleable bundle of gates. SCOPING is
--     expressed by two NULLABLE columns, where NULL means "any":
--       project_id NULL + agent_ref NULL  → applies tenant-wide
--       project_id = 7                    → only runs on project 7
--       agent_ref  = 'ada'                → only runs dispatched AS agent `ada`
--     (both set = the intersection). No scope_kind discriminator: NULL-as-wildcard
--     makes the resolver one SQL predicate instead of a branch per kind.
--
--   policy_gates — one row per `PolicyGate`. `gate_key` is the wire `id`; `tool` is
--     the matcher (NULL or '*' = every tool, which is what makes a broad deny-by-
--     default posture authorable); `effect` is the enum the evaluator switches on.
--
-- Segment-threaded like the rest of governance (segment_id nullable for
-- non-segmented tenants). Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS policy_packs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  uuid REFERENCES segments(id) ON DELETE CASCADE,
  name        varchar(200) NOT NULL,
  description text,
  enabled     boolean NOT NULL DEFAULT true,
  -- NULL = applies to every project / every agent (see header).
  project_id  integer REFERENCES projects(id) ON DELETE CASCADE,
  agent_ref   varchar(128),
  created_by  varchar(64),
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

-- The resolver's hot predicate: every dispatch asks "enabled packs for this tenant".
CREATE INDEX IF NOT EXISTS idx_policy_packs_tenant ON policy_packs (tenant_id, enabled);
CREATE INDEX IF NOT EXISTS idx_policy_packs_project ON policy_packs (tenant_id, project_id);

CREATE TABLE IF NOT EXISTS policy_gates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pack_id    uuid NOT NULL REFERENCES policy_packs(id) ON DELETE CASCADE,
  -- The `PolicyGate.id` that travels on the wire and is echoed back in a block /
  -- approval decision. Unique per pack so a decision names exactly one gate.
  gate_key   varchar(128) NOT NULL,
  -- NULL or '*' → governs EVERY tool call (a broad block = deny-by-default posture).
  tool       varchar(128),
  effect     varchar(20) NOT NULL,
  directive  text,
  reason     text,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT policy_gates_effect_check
    CHECK (effect IN ('inject-directive', 'require-approval', 'block'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_gate_key ON policy_gates (pack_id, gate_key);
CREATE INDEX IF NOT EXISTS idx_policy_gates_pack ON policy_gates (pack_id, position);
