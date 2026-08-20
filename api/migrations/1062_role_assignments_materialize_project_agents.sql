-- 1062 — the project's "Agents" list and its roster stop disagreeing.
--
-- THE DEFECT
-- ------------------------------------------------------------------------------
-- Two lists described the same fact and neither knew about the other. The
-- Agent/Capabilities tab's "Agents (N)" reads `project_agents`; the Recommended
-- roster (`KanbanRosterCard`) reads `project_role_assignments`. So an agent
-- staffed onto a role through the roster never appeared in the capabilities
-- list — and, worse, had no `project_agents.id`, which is the scope every
-- per-agent skill, persona and content assignment hangs off
-- (`artifact_assignments.scope='agent'`). The roster could staff an agent that
-- could not then be given anything.
--
-- `RoleAssignmentService.create` now materializes the attachment as part of the
-- staffing decision. This backfills the assignments made before it did.
--
-- WHY `agent_kind = 'workforce'`
-- ------------------------------------------------------------------------------
-- A role assignment's `assignee_ref` is a workforce agent key; `registered` is
-- the other kind, and it is never what the roster stores. Matching the service.
--
-- ON CONFLICT DO NOTHING against `uq_project_agents_attachment`: an agent that is
-- already attached keeps its existing row — renumbering it would orphan every
-- artifact assignment pointing at the old id.

INSERT INTO project_agents (tenant_id, project_id, agent_kind, agent_ref, name, role, added_by, created_at, updated_at)
SELECT
  ra.tenant_id,
  ra.project_id,
  'workforce',
  ra.assignee_ref,
  COALESCE(NULLIF(TRIM(ra.assignee_name), ''), ra.assignee_ref),
  LEFT(ra.role_key, 64),
  ra.created_by,
  NOW(),
  NOW()
FROM project_role_assignments ra
WHERE ra.assignee_kind = 'agent'
  AND ra.project_id IS NOT NULL
ON CONFLICT DO NOTHING;
