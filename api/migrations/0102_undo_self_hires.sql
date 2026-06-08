-- 0102: undo self-hires (a tenant that hired its OWN agent).
--
-- POST /api/workforce/agents/:id/hire never checked ownership, so a tenant could
-- "hire" an agent it already owns. That left the agent showing twice in
-- /workforce (once via /agents/mine, once via /agents/purchased) and bumped
-- ide_agents.hire_count. The duplicate "purchased" card also detects ownership
-- and renders owner actions with no handlers instead of an Unhire button — so the
-- duplicate could not be released. The route now rejects self-hire (409); this
-- migration unwinds the rows already created by the old behaviour.
--
-- For every currently-active self-purchase (purchase tenant == agent owner):
--   1. correct the cumulative hire_count by the count of such bogus self-hires
--      (floored at 0) — they were never legitimate hires, so they must not inflate
--      the "times hired" stat; this is a one-time data repair, NOT a runtime unhire,
--   2. soft-delete the purchase row (stamp unhired_at) so it drops out of the
--      active "purchased" list (and active_hires), which is what re-enables delete.
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
