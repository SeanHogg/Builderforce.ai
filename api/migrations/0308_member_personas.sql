-- 0308_member_personas.sql
-- Persona-role 2D RBAC — a LATERAL "lens persona" dimension (CEO / CFO / CTO /
-- CISO / PMO / EM / IC) that sits ALONGSIDE the four-tier access level
-- (viewer < developer < manager < owner), not on top of it.
--
-- The access level answers "what may this user DO" (the hard gate, enforced by
-- requireRole). The persona answers "what does this user WANT TO SEE FIRST" — it
-- is a VIEW-shaping dimension that reorders / highlights insight lenses for the
-- role the person plays (a CFO lands on Finance + Allocation; a CISO on
-- Compliance). It NEVER grants access the role lacks — a viewer with a 'ceo'
-- persona still sees every manager lens gated.
--
-- Keyed by (tenant_id, user_id) — a user can carry several personas but exactly
-- one is_primary (enforced in the route: a self/manager write flips the others
-- off). No FK on user_id (users.id is a varchar elsewhere in this schema and the
-- membership is validated in the route, matching member_profiles/team_members).
--
-- Idempotent / re-runnable.

CREATE TABLE IF NOT EXISTS member_personas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     VARCHAR(64) NOT NULL,                 -- users.id (validated in-route)
  -- lens persona (enum-ish varchar so a new lateral role needs no type migration):
  --   ceo | cfo | cto | ciso | pmo | em | ic
  persona     VARCHAR(16) NOT NULL,
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (tenant, user, persona) — upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_persona
  ON member_personas(tenant_id, user_id, persona);

-- Roster reads (manager-sees-all) + "my personas" lookups.
CREATE INDEX IF NOT EXISTS idx_member_personas_tenant ON member_personas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_member_personas_user   ON member_personas(tenant_id, user_id);

-- At most one primary persona per (tenant, user). Partial unique index enforces it
-- at the DB even though the route also flips siblings off on a primary write.
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_persona_primary
  ON member_personas(tenant_id, user_id) WHERE is_primary;
