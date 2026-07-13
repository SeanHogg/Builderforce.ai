-- 0326_incident_manager_agent.sql
-- The Incident Manager — a specialized "manager" agent seeded into every tenant's
-- workforce, the help-desk/incident-response counterpart of the Security agent (0291)
-- and Validator (0271).
--
-- Like the others it is an ordinary, assignable cloud agent (an ide_agents row)
-- marked with the stable builtin_kind='incident_manager' marker (0289) so dispatch
-- keeps finding it after a rename. Its persona steers the cloud run to: read an
-- inbound help-desk ticket (Freshdesk / Freshservice), classify WHICH SYSTEM it
-- pertains to, open a first-class incident via the `incidents.open` MCP tool (→
-- IncidentService: a bridged prod_incidents record + one 'incident' board ticket),
-- page the on-call list via `oncall.page`, and post updates to the war-room chat.
-- No Incident Manager agent ⇒ the incident triage/escalation sweep no-ops for that
-- tenant (no separate feature flag).
--
-- Idempotent: NOT EXISTS-guarded seed. New tenants provisioned after this migration
-- get the agent at tenant-creation time (provisionBuiltinAgents). builtin_kind is a
-- plain varchar, so this migration is safe despite 0325 having ADDed the 'incident'
-- task_type enum value in a prior file.

INSERT INTO ide_agents (id, tenant_id, name, title, bio, skills, base_model, status, runtime_support, published, price_cents, builtin_kind)
SELECT
  'incident-manager-t' || t.id,
  t.id,
  'Incident Manager',
  'Incident Manager — help-desk triage, on-call paging & escalation',
  'Runs the help desk and the first minutes of incident response. Reads inbound support tickets (Freshdesk / Freshservice), works out which system the issue pertains to, and for anything that reads as an incident opens a first-class incident — a tracked board ticket bridged to the incident record with a severity. It then pages the right on-call list, opens an on-call war-room chat, posts status updates (in-app + MS Teams), and escalates to the next on-call tier and business contacts on a timer until someone acknowledges.',
  '["incident-response","triage","on-call","itsm","escalation","help-desk"]',
  'builderforce-default',
  'active',
  'cloud',
  FALSE,
  0,
  'incident_manager'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM ide_agents a WHERE a.tenant_id = t.id AND a.builtin_kind = 'incident_manager'
);
