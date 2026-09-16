-- 1177 · Coordinating a ticket is developer-tier work; the manager gate is opt-IN.
--
-- Five kanban routes — `POST /tasks/:id/coordinate`, `POST /tasks/:id/participants`,
-- `PATCH /tasks/:id/participants/assign`, `DELETE /tasks/:id/participants/:pid` and
-- `POST /tasks/:id/participants/materialize` — demanded the MANAGER role outright.
-- That made them unreachable for the ordinary case they exist to serve: a developer,
-- or an agent acting for one, staffing the ticket it is about to work on. Measured on
-- VS Code chat #113, where the caller was the workspace OWNER and three coordination
-- tools in a row came back `403 {"error":"manager role required"}`.
--
-- Operator decision: agent-driven coordination is DEVELOPER-tier by default. A project
-- that wants staffing decisions concentrated in its manager opts IN by turning this on
-- (`manager.configure { projectId, coordinationRequiresManager: true }`), and the gate
-- then refuses below manager with a remedy naming the setting.
--
-- PROJECT-ONLY, so there is deliberately no matching column on
-- `tenant_manager_defaults`: this describes how ONE board is run, not a workspace's
-- posture. NOT NULL DEFAULT false like `require_signoff_to_complete` — with no
-- workspace tier there is nothing to inherit, so the column always states the answer
-- outright rather than carrying a NULL that means "ask someone else".
--
-- Idempotent (IF NOT EXISTS); no new table.

ALTER TABLE project_manager_configs
  ADD COLUMN IF NOT EXISTS coordination_requires_manager boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN project_manager_configs.coordination_requires_manager IS
  'Do the ticket coordination routes (coordinate / assess_resource / assign+remove participant / materialize) require the manager role on this project? Default false — any developer or agent may coordinate. See application/kanban/coordinationGate.ts.';
