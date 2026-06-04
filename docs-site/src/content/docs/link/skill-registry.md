---
title: Skill Registry
description: How BuilderForce Agents fetches, merges, and applies portal-managed skills at startup
---

# Skill Registry

BuilderForce Agents maintains a **skill registry** — a local cache of skills fetched from the Builderforce portal at startup. Skills extend agent behaviour with domain knowledge, tool definitions, and workflow templates, all managed centrally from the portal and delivered to every agent automatically.

> For the portal-side skills UI and marketplace, see [Skills Marketplace](/link/marketplace/).

---

## Startup fetch

When BuilderForce Agents starts with a Builderforce connection configured, it calls:

```
GET /api/agents/:id/skills
Authorization: Bearer <agentNodeApiKey>
```

This returns the **merged** skill list for the agent — the union of tenant-level assignments and any agent-specific overrides. BuilderForce Agents loads this set into the local skill registry and logs what was loaded:

```
[skill-registry] loaded 4 skill(s): typescript-strict, github-api, test-runner, our-coding-standards
```

Skills are available for the lifetime of the process. To pick up new assignments added in the portal, restart the agent.

---

## Assignment precedence

Skills can be assigned at two scopes:

| Scope | Assigned in portal | Applies to |
|-------|-------------------|------------|
| Tenant-level | Settings → Skills → Tenant Assignments | All agents in the organisation |
| Agent-level | Agent detail panel → Skills tab | This specific agent only |

When the same skill slug appears at both scopes, the **agent-level assignment wins**. This lets you override a tenant-wide skill with a agent-specific version without affecting others.

---

## What a loaded skill provides

Each skill in the registry contributes one or more of:

- **System prompt fragment** — injected into the agent's system prompt at session start
- **Tool definitions** — additional tools the agent can call (e.g. `create_github_pr`, `run_test_suite`)
- **Workflow templates** — runbook steps the orchestrator can reference

Agents do not need to be told about their skills. Once loaded, a skill's knowledge and tools are simply available.

---

## Querying the registry

Check the active skill list from the CLI:

```bash
builderforce skills list
```

The output shows both local (bundled/workspace) skills and portal-managed skills. Portal-managed skills are tagged with their source (`tenant` or `agent`).

To see the raw registry state and which Builderforce assignment each skill came from:

```bash
builderforce skills list --verbose
```

---

## Adding and removing skills at runtime

The skill registry is fetched at startup. There is no hot-reload — add or remove assignments in the portal, then restart the agent to apply them.

To check what assignments are active in the portal for a given agent without restarting:

1. Open the agent detail panel in the Builderforce portal
2. Navigate to the **Skills** tab

The Skills tab shows both tenant-level assignments (inherited) and agent-level overrides, and whether each skill is currently loaded (i.e., the agent has fetched it).

---

## Building custom skills

Custom skills follow the same structure as marketplace skills and can be kept private to your tenant:

```markdown
## Code Style

Always use TypeScript strict mode. Prefer `const` over `let`.
Never use `any` — use `unknown` and narrow with type guards.
All async functions must handle errors explicitly.
```

Optionally include tool definitions:

```json
{
  "name": "create_github_pr",
  "description": "Create a pull request on GitHub",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "branch": { "type": "string" },
      "base": { "type": "string", "default": "main" }
    },
    "required": ["title", "branch"]
  }
}
```

Publish the skill from [Skills](/link/marketplace/) → **Publish Skill** in the portal. Set the `public` flag to false to keep it private to your tenant.

---

## Standalone mode (no Builderforce)

Without a Builderforce connection, the skill registry is populated from local sources only:

- Bundled skills (shipped with BuilderForce Agents)
- Workspace skills in `.builderforce/skills/`
- Skills installed via `builderforce agenthub install`

Portal-managed skills are not available in standalone mode. This is noted at startup:

```
[skill-registry] No Builderforce connection — skipping portal skill fetch
```

---

## Troubleshooting

**Skills not loading after portal assignment**

- Restart the agent — skills are fetched once at startup.
- Check `BUILDERFORCE_AGENTS_LINK_URL` and `BUILDERFORCE_AGENTS_LINK_API_KEY` are set.
- Check `builderforce logs` for `[skill-registry]` entries.

**Wrong skill version loading**

- Agent-level assignments override tenant-level assignments for the same slug.
- If you recently updated a skill in the portal, restart the agent to fetch the updated version.

**Skill appears in portal but not in `builderforce skills list`**

- Confirm the agent has been restarted since the assignment was made.
- Confirm the assignment is at the correct scope (tenant vs agent).
