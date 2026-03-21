---
title: Specs and Planning — From Idea to Executable Task with AI
date: 2026-03-14
description: How Builderforce.ai structures product thinking into actionable agent work — using specs, PRDs, architecture documents, and AI-assisted task breakdown to move from raw ideas to a running multi-agent workflow.
tags: [specs, planning, prd, architecture, tasks, brainstorm, ai-planning]
author: Sean Hogg
---

# Specs and Planning — From Idea to Executable Task with AI

Most AI coding tools start at the code. They assume you already know what to build. Builderforce disagrees.

The best engineering work starts with clear thinking: what is the problem, what does the solution look like architecturally, and what are the discrete units of work needed to get there. Builderforce gives you AI-assisted tools for each stage, and a structured **spec** that carries your thinking all the way through to executing agents.

---

## The Planning Stack

Builderforce organises planning into four layers, each feeding the next:

```
Idea / goal (free text)
    │
    ▼
PRD (Product Requirements Document)  ◄── AI-assisted in Brainstorm
    │
    ▼
Architecture Spec                    ◄── AI-assisted in Brainstorm
    │
    ▼
Task list (JSON)                     ◄── AI-generated from spec
    │
    ▼
Executable tasks                     ──► Agent execution on CoderClaw
```

The spec is the container that holds all four layers in one place.

---

## Starting with Brainstorm

[/brainstorm](/brainstorm) is the ideation environment — an AI-assisted chat interface purpose-built for product thinking, not coding.

Open Brainstorm and start with a goal:

> "I want to build a feature that lets users export their project activity as a PDF report."

The AI assistant helps you:

- **Refine the goal** — scope it, challenge assumptions, identify edge cases
- **Draft the PRD** — user stories, acceptance criteria, non-functional requirements, out-of-scope items
- **Generate the architecture spec** — component breakdown, data model changes, API design, migration considerations

When you are happy with the output, click **Save as Spec** to create a spec record linked to your project.

---

## The Spec Record

A spec lives in [/tasks](/tasks) → **Specs** tab. Each spec has a status lifecycle:

```
draft → reviewed → approved → in_progress → done
```

The spec stores:

| Field | Contents |
|---|---|
| **Goal** | One-sentence statement of what this spec achieves |
| **PRD** | Full product requirements document (Markdown) |
| **Architecture spec** | Technical design document (Markdown) |
| **Task list** | JSON array of tasks ready for the board |
| **Status** | Current stage in the approval workflow |
| **Linked claw** | Which CoderClaw instance will execute it |
| **Linked project** | The project this spec belongs to |

---

## Generating the Task List

Once the PRD and architecture spec are written, Builderforce (or an AI assistant in the spec editor) can generate the **task list** — a structured breakdown of every piece of work needed to implement the spec.

A task list entry looks like:

```json
{
  "title": "Add PDF export endpoint to the API",
  "description": "Implement POST /api/projects/:id/export/pdf that streams a generated PDF using Puppeteer",
  "priority": "medium",
  "persona": "coder",
  "dependsOn": ["Add PDF template component"]
}
```

The task list is reviewed in the spec editor. You can add, remove, and reorder tasks, adjust priorities, and assign personas (which CoderClaw agent role should handle each task).

---

## Promoting to the Task Board

When the spec is `approved`, click **Create Tasks** to push the task list to the [Tasks](/tasks) board. Each entry in the task list becomes a task record in the backlog.

From here, tasks follow the normal task lifecycle — they can be triaged, prioritised, assigned to specific claws, and submitted for execution. The spec remains linked to each task, so you can always trace any task back to the original PRD.

---

## Spec Workflows

When you submit a spec for execution (rather than converting it to individual tasks), Builderforce creates a **spec workflow** — a CoderClaw orchestration that treats the entire spec as a unit of work.

The spec workflow type `planning` runs:

1. **Planner** — reads the spec goal and PRD, produces a detailed execution plan
2. **Architect** — reviews the architecture spec and produces implementation notes
3. **Coder** — implements the first round of changes based on the plan
4. **Reviewer** — reviews the code against the spec's acceptance criteria

Each step appears in the [Workflows](/workflows) portal as it executes. You can watch the agents work through the spec in real time.

---

## Collaboration on Specs

Specs are shared documents — any team member with access to the project can read, comment on, and edit the spec. The Brainstorm chat history is preserved with the spec, so the reasoning behind decisions is always visible.

For specs that affect production systems, add a **reviewer** to the spec before approving it. The reviewer is notified and their approval moves the spec from `reviewed` to `approved`. This is a lightweight human gate before work begins — separate from the execution-level approval gates that fire during agent work.

---

## Integrating with Source Control

When a spec's tasks are complete and a pull request is created, you can link the PR back to the spec:

1. Open the task that produced the PR
2. Paste the GitHub PR URL into the **PR URL** field
3. The spec's status updates automatically when the PR merges

If you have a GitHub source control integration configured (Settings → Source Control), CoderClaw can create and link PRs automatically without the manual step.

---

## Governance and Constraints

The spec's architecture doc is also the right place to record **project governance** — the rules your agents must follow when working in this project. Governance docs are synced to the claw's `.coderClaw/context.yaml` as part of the assignment context, so agents load them at startup and follow them throughout execution.

Governance examples:

- "All database changes must include a migration file"
- "No direct writes to the `users` table — use the UserService"
- "Every PR must include tests for new functionality"
- "Never use `eval()` or `Function()` constructor"

Agents trained with relevant skills will interpret these constraints naturally and apply them without further prompting.

---

## Best Practices

**Write the PRD before the architecture spec.** It is tempting to jump to "how to build it" — but a clear PRD forces you to answer "what problem are we solving" first. Architecture decisions that flow from a clear problem statement are much less likely to be wrong.

**Keep tasks small and atomic.** A task that takes a skilled human engineer 4 hours is the right size for an agent. Larger tasks tend to produce sprawling implementations that are hard to review and revert.

**Use personas in the task list.** A `coder` task and a `reviewer` task for the same feature ensure both implementation and review happen — not just one or the other. The spec task list is the right place to enforce this discipline.

**Review the architecture spec before approving.** Agents are remarkably good at implementing what you describe. If the architecture spec is wrong, the implementation will faithfully reproduce the mistake.

---

## Next Steps

- Open [Brainstorm](/brainstorm) and write your next feature spec with AI assistance
- Navigate to [Tasks](/tasks) → Specs to see your current planning documents
- Read [Task Execution and Observability](/blog/task-execution-and-observability) to understand what happens once tasks are created and dispatched to agents
- See [Approval Gates](/blog/approval-gates-and-human-oversight) for how to add human checkpoints at the spec approval and task execution stages
