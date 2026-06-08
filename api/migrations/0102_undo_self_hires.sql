-- 0102: undo self-hires (a tenant that hired its OWN agent).
--
-- POST /api/workforce/agents/:id/hire never checked ownership, so a tenant could
-- "hire" an agent it already owns. That left the agent showing twice in
-- /workforce (once via /agents/mine, once via /agents/purchased) AND bumped
-- ide_agents.hire_count, which then BLOCKED deletion (canDeleteAgent requires
-- hire_count === 0). Worse, the duplicate "purchased" card detects ownership and
-- renders owner actions with no handlers instead of an Unhire button — so the
-- duplicate can't be released. The route now rejects self-hire (409); this
-- migration unwinds the rows already created by the old behaviour.
--
-- For every currently-active self-purchase (purchase tenant == agent owner):
--   1. decrement the agent's hire_count by the count of such rows (floored at 0),
--   2. soft-delete the purchase row (stamp unhired_at) so it drops out of the
--      active "purchased" list but keeps its provenance, mirroring a normal unhire.
-- Idempotent: after it runs there are no active self-purchases left to match.

UPDATE ide_agents a
SET hire_count = GREATEST(a.hire_count - c.n, 0), updated_at = NOW()
FROM (
  SELECT p.agent_id, COUNT(*)::int AS n
  FROM agent_purchases p
  JOIN ide_agents ia ON ia.id = p.agent_id
  WHERE p.unhired_at IS NULL AND ia.tenant_id = p.tenant_id
  GROUP BY p.agent_id
) c
WHERE a.id = c.agent_id;

UPDATE agent_purchases p
SET unhired_at = NOW()
FROM ide_agents a
WHERE a.id = p.agent_id
  AND p.unhired_at IS NULL
  AND a.tenant_id = p.tenant_id;
