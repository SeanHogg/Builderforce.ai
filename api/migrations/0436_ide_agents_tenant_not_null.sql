-- Make the Drizzle tenant invariant truthful for the workforce registry.
-- Migration 0075 added tenant_id as nullable so existing project-backed agents could
-- survive rollout. Every project has a tenant, so repair those historical rows first;
-- all current writers already stamp tenant_id directly.

UPDATE ide_agents AS agent
SET tenant_id = project.tenant_id
FROM projects AS project
WHERE agent.tenant_id IS NULL
  AND agent.project_id = project.id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ide_agents WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'ide_agents contains tenantless rows with no owning project; repair them before applying 0436';
  END IF;
END $$;

ALTER TABLE ide_agents ALTER COLUMN tenant_id SET NOT NULL;

-- PRD 20's consolidated OTP store is deliberately pre-tenant: signup and marketing
-- challenges can exist before an account/workspace does. Migration 0432 introduced a
-- tenant_id on its earlier shape and 0433 documented its removal without actually
-- dropping the pre-existing column when CREATE TABLE IF NOT EXISTS was a no-op.
ALTER TABLE email_otp_challenges DROP COLUMN IF EXISTS tenant_id;
