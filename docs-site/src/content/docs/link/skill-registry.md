---
title: Skill Registry
description: How CoderClaw fetches, merges, and applies portal-managed skills at startup
---

# Skill Registry

CoderClaw maintains a **skill registry** — a local cache of skills fetched from the Builderforce portal at startup. Skills extend agent behaviour with domain knowledge, tool definitions, and workflow templates, all managed centrally from the portal and delivered to every claw automatically.

> For the portal-side skills UI and marketplace, see [Skills Marketplace](/link/marketplace/).

---

## Startup fetch

When CoderClaw starts with a Builderforce connection configured, it calls:

```
GET /api/claws/:id/skills
Authorization: Bearer <clawApiKey>
```

This returns the **merged** skill list for the claw — the union of tenant-level assignments and any claw-specific overrides. CoderClaw loads this set into the local skill registry and logs what was loaded:

```
[skill-registry] loaded 4 skill(s): typescript-strict, github-api, test-runner, our-coding-standards
```

Skills are available for the lifetime of the process. To pick up new assignments added in the portal, restart the claw.

---

## Assignment precedence

Skills can be assigned at two scopes:

| Scope | Assigned in portal | Applies to |
|-------|-------------------|------------|
| Tenant-level | Settings → Skills → Tenant Assignments | All claws in the organisation |
| Claw-level | Claw detail panel → Skills tab | This specific claw only |

When the same skill slug appears at both scopes, the **claw-level assignment wins**. This lets you override a tenant-wide skill with a claw-specific version without affecting others.

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
coderclaw skills list
```

The output shows both local (bundled/workspace) skills and portal-managed skills. Portal-managed skills are tagged with their source (`tenant` or `claw`).

To see the raw registry state and which Builderforce assignment each skill came from:

```bash
coderclaw skills list --verbose
```

---

## Adding and removing skills at runtime

The skill registry is fetched at startup. There is no hot-reload — add or remove assignments in the portal, then restart the claw to apply them.

To check what assignments are active in the portal for a given claw without restarting:

1. Open the claw detail panel in the Builderforce portal
2. Navigate to the **Skills** tab

The Skills tab shows both tenant-level assignments (inherited) and claw-level overrides, and whether each skill is currently loaded (i.e., the claw has fetched it).

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

- Bundled skills (shipped with CoderClaw)
- Workspace skills in `.coderClaw/skills/`
- Skills installed via `coderclaw clawhub install`

Portal-managed skills are not available in standalone mode. This is noted at startup:

```
[skill-registry] No Builderforce connection — skipping portal skill fetch
```

---

## Troubleshooting

**Skills not loading after portal assignment**

- Restart the claw — skills are fetched once at startup.
- Check `CODERCLAW_LINK_URL` and `CODERCLAW_LINK_API_KEY` are set.
- Check `coderclaw logs` for `[skill-registry]` entries.

**Wrong skill version loading**

- Claw-level assignments override tenant-level assignments for the same slug.
- If you recently updated a skill in the portal, restart the claw to fetch the updated version.

**Skill appears in portal but not in `coderclaw skills list`**

- Confirm the claw has been restarted since the assignment was made.
- Confirm the assignment is at the correct scope (tenant vs claw).
