-- 0289_agent_builtin_kind.sql
-- Stable built-in-agent marker on ide_agents.
--
-- Built-in agents (the seeded "Validator" today; Security, etc. in future) may be
-- RENAMED by a team so the agent feels like one of the group ("Alice" instead of
-- "Validator"). Their identity and behavior must therefore key off something OTHER
-- than the display name. `builtin_kind` is that stable marker: dispatch and the
-- workforce card's type indicator read it; `name` stays free to rename.
--
-- Backfill: every existing Validator (seeded row named 'Validator', or a copy whose
-- id ends '-validator') is tagged builtin_kind='validator' so validationDispatch's
-- switch to the kind predicate keeps finding it after a rename.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded UPDATE. Partial index keeps the
-- per-tenant "does this tenant have a Validator?" lookup a cheap indexed scan.

ALTER TABLE ide_agents ADD COLUMN IF NOT EXISTS builtin_kind VARCHAR(32);

UPDATE ide_agents
SET builtin_kind = 'validator'
WHERE builtin_kind IS NULL
  AND (name = 'Validator' OR id LIKE '%-validator');

CREATE INDEX IF NOT EXISTS idx_ide_agents_builtin_kind
  ON ide_agents (tenant_id, builtin_kind)
  WHERE builtin_kind IS NOT NULL;
