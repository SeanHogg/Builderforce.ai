-- 0101: soft-delete for agent purchases (unhiring).
--
-- "Unhiring" a marketplace agent used to hard-DELETE the agent_purchases row.
-- That erased the record that the tenant had ever hired the agent — so any work
-- the agent did for the tenant lost its hire provenance, and the agent could
-- silently disappear from contributor/performance history.
--
-- Unhire is now a SOFT delete: the row stays, with unhired_at stamped. The
-- purchased list filters to unhired_at IS NULL (active hires only), while every
-- history/attribution surface can still see the row. Re-hiring revives the same
-- row (unhired_at back to NULL) — the (tenant, agent) pair stays unique.
ALTER TABLE agent_purchases ADD COLUMN IF NOT EXISTS unhired_at timestamp NULL;

-- Active-hire lookups (purchased list, deletion blocker) hit this partial index.
CREATE INDEX IF NOT EXISTS idx_agent_purchases_active
  ON agent_purchases (tenant_id, agent_id) WHERE unhired_at IS NULL;
