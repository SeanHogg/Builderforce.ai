-- 0271_seed_validator_agent.sql
-- Seed the built-in "Validator" agent into every existing tenant's workforce.
--
-- The Validator is a first-class, assignable cloud agent with programming + BA
-- (business-analyst / team-lead) skills. Its job: review "Done" work items against
-- the actual codebase, decide whether the delivered code FULLY satisfies the ticket
-- or whether gaps remain, flag each item reviewed (repeatedly — a Done item accrues
-- multiple review passes over time), and file a GAP task for every gap it finds.
--
-- It is an ordinary ide_agents row (so it shows up in Workforce and can be assigned
-- like any agent), named 'Validator' with an id ending '-validator' — the two markers
-- validationDispatch.findTenantValidatorRef / runValidatorReviewSweep key off to
-- auto-review a tenant's Done items on the daily cron. Its persona/skills steer the
-- cloud run to perform an acceptance review and report via the `reviews.record`
-- built-in MCP tool (→ ValidationService: review ledger + GAP tasks).
--
-- Idempotent: guarded by NOT EXISTS on (tenant, name='Validator'); re-running is a
-- no-op. New tenants provisioned after this migration get a Validator via onboarding
-- (tracked in the ROADMAP gap register) — the sweep no-ops for a tenant without one.

INSERT INTO ide_agents (id, tenant_id, name, title, bio, skills, status, runtime_support, published, price_cents)
SELECT
  'validator-t' || t.id,
  t.id,
  'Validator',
  'Validator — Team Lead (acceptance review: QA + BA)',
  'Reviews Done work against the codebase like a senior team lead. Verifies the delivered code fully satisfies the ticket end-to-end — requirements coverage, wiring, edge cases, tests, and docs. Flags each item reviewed and files a GAP task for anything missing, so nothing ships half-done.',
  '["code-review","business-analysis","acceptance-testing","validation"]',
  'active',
  'cloud',
  FALSE,
  0
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM ide_agents a WHERE a.tenant_id = t.id AND a.name = 'Validator'
);
