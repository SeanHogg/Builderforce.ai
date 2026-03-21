---
title: Skills, Assignments, and the Marketplace — Equipping Your Agents
date: 2026-03-13
description: How the Builderforce skills system works — from browsing and publishing in the marketplace, to assigning skills at tenant or claw scope, to how skills load into running CoderClaw agents at startup.
tags: [skills, marketplace, assignments, agents, plugins, extensions]
author: Sean Hogg
---

# Skills, Assignments, and the Marketplace — Equipping Your Agents

An agent's built-in capabilities are its starting point. Skills are how you extend those capabilities — injecting domain knowledge, API integrations, structured workflows, and specialist behaviour without retraining the underlying model.

Builderforce has two ways to get skills onto your agents: the **Skills Marketplace** (community-published, browse and assign) and **custom skills** (you build them, you own them). Both follow the same assignment model, and both are loaded automatically onto your CoderClaw instances at startup.

---

## What Is a Skill?

A skill is a structured capability extension. At its simplest, a skill is a **system prompt fragment** that gives an agent specific knowledge or instructions. More sophisticated skills include:

- **Tool definitions** — structured function signatures the agent can call (e.g. a GitHub API skill that defines `create_pr`, `add_comment`, `merge_branch`)
- **Workflow templates** — step-by-step runbooks the agent follows (e.g. an incident response skill that defines the triage → diagnose → fix → communicate loop)
- **Domain knowledge** — embedded reference material the agent uses at inference time (e.g. a `typescript-strict` skill that embeds your team's TypeScript conventions)

When a skill is loaded, the agent behaves as if it already knew everything in the skill. No prompting required.

---

## The Skills Marketplace

Navigate to [/skills](/skills) to browse published skills from the community.

Each skill listing shows:

| Field | Description |
|---|---|
| **Name and slug** | Unique identifier used for assignment (`org/skill-name`) |
| **Description** | What the skill teaches the agent |
| **Category** | Broad domain tag (development, operations, marketing, etc.) |
| **Tags** | Detailed capability tags for filtering |
| **Version** | Current published version |
| **Downloads** | How many times it has been assigned |
| **Likes** | Community quality signal |
| **Author** | Who published it |

### Browsing and Filtering

The marketplace search supports:

- **Full-text** — searches name, description, and tags
- **Category filter** — narrow by domain
- **Tag filter** — find skills with specific capability tags
- **Sort by** — downloads, likes, or newest

### Publishing a Skill

If you have built a skill for your agents that other teams might benefit from:

1. Go to [/skills](/skills) → **Publish Skill**
2. Fill in the name, slug, description, category, and tags
3. Paste your skill definition (system prompt fragment, tool schemas, or workflow template)
4. Click **Publish**

Published skills are immediately searchable in the marketplace. You can update the metadata and content at any time, and published versions are tracked so consumers can pin to a specific version.

---

## Assigning Skills

A skill does nothing until it is **assigned** — linked to the agents or claws that should use it. Builderforce has a two-level assignment model.

### Tenant-Level Assignments

A **tenant-level assignment** makes a skill available to **all claws** in your organisation. Use this for skills that every agent should have — your coding standards, your API conventions, your company-specific tooling.

Manage tenant assignments from [/skills](/skills) → **Tenant Assignments** tab:

1. Search for or paste the skill slug
2. Click **Assign to All Claws**
3. The skill appears in every claw's skill registry at its next startup

### Claw-Level Assignments

A **claw-level assignment** overrides or adds a skill for a specific CoderClaw instance. Use this to equip a specialist claw — your `frontend-workstation` might have React and Tailwind skills that no other claw needs.

Manage claw assignments from the claw detail panel → **Skills** tab:

1. Click **Assign Skill**
2. Search and select the skill
3. The assignment takes effect at the claw's next startup

Claw-level assignments **override** tenant-level assignments when the same skill slug appears at both levels — the claw-specific configuration wins.

---

## How Skills Load at Startup

When CoderClaw starts and a Builderforce connection is configured, it fetches the merged skill list:

```
GET /api/claws/:id/skills
```

This returns the union of:
1. All tenant-level skill assignments
2. All claw-level overrides for this specific claw

The merged set is loaded into the claw's local **skill registry** and is available to agents for the lifetime of that process. If you add a new skill assignment in the portal, the claw picks it up the next time it restarts.

To check what skills a running claw has loaded, look at its startup logs:

```
[skill-registry] loaded 4 skill(s): typescript-strict, github-api, test-runner, our-coding-standards
```

Or query the portal from the claw's **Skills** tab, which shows the live assignment state.

---

## Artifact Assignments: The Full Scope Model

Skills are one type of **artifact**. Builderforce uses a unified **artifact assignment** system that works for skills, personas, and content at any scope level:

| Scope | Applies to |
|---|---|
| `tenant` | All claws and agents in the organisation |
| `claw` | A specific CoderClaw instance |
| `project` | Any claw working on a specific project |
| `task` | The agent executing a specific task |

Scope resolution follows precedence: `task > project > claw > tenant`. If a task has a specific skill assigned, that assignment wins even if the tenant-level assignment says something different.

Manage artifact assignments from [/skills](/skills) → **Artifact Assignments**, where you can assign any artifact type at any scope from a single interface.

---

## Building Custom Skills

Skills are not just for the marketplace. For internal tooling, proprietary workflows, or company-specific conventions, build private skills that never leave your tenant.

A skill definition has three parts:

**1. System prompt fragment**
```markdown
## Code Style
Always use TypeScript strict mode. Prefer `const` over `let`.
Never use `any` — use `unknown` and narrow with type guards.
All async functions must handle errors explicitly.
```

**2. Tool definitions (optional)**
```json
{
  "name": "create_github_pr",
  "description": "Create a pull request on GitHub",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "branch": { "type": "string" },
      "base": { "type": "string", "default": "main" },
      "body": { "type": "string" }
    },
    "required": ["title", "branch"]
  }
}
```

**3. Metadata**
```json
{
  "name": "Our TypeScript Standards",
  "slug": "acme/typescript-standards",
  "category": "development",
  "tags": ["typescript", "code-style", "internal"],
  "version": "1.0.0"
}
```

Private skills (published without the `public` flag) are visible only to your tenant.

---

## Cron-Triggered Skills

Skills can also back **scheduled jobs**. If you have a skill that performs a daily standup summary, a weekly dependency audit, or a nightly test run, pair it with a cron job from the [Dashboard](/dashboard) → **Cron** tab:

```
Schedule: 0 9 * * 1-5   (9am Monday–Friday)
Task: "Run the daily standup summary skill for project X"
```

The cron poller on the assigned claw fetches the job schedule at startup and executes the task at the right time. No external cron infrastructure required.

---

## Best Practices

**One skill, one concern.** A skill that covers TypeScript, testing, GitHub, and deployment is hard to maintain and hard to debug. Split into focused skills (`typescript-style`, `jest-patterns`, `github-actions`) and compose them through assignments.

**Version skills before updating.** If a skill update would change agent behaviour, bump the version before publishing. Consumers pinned to `v1.2` are unaffected; consumers who want the new behaviour explicitly update their assignment.

**Test skills in isolation before tenant-wide assignment.** Assign a new skill to one claw first, run a few tasks, check the output. Once you are confident, promote to tenant-level.

**Use personas alongside skills.** A skill teaches knowledge; a persona shapes voice and decision style. The combination — a claw with your TypeScript skill and your "senior engineer" persona — produces more consistent, on-brand output than either alone.

---

## Next Steps

- Browse the [Skills Marketplace](/skills) and assign your first community skill
- Read [Multi-Agent Orchestration](/blog/multi-agent-orchestration) to see how skill-equipped claws fit into a workflow
- Explore [Fleet Management](/blog/fleet-management-and-claw-routing) to understand how skills compose with claw-level capability declarations
