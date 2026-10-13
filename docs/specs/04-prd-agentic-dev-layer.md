# 04 — PRD: Agentic Software-Development Layer

This is the **net-new** value of BuilderForce — the reason it's a product, not just a port. The
PM and Agile pillars produce a structured graph of *what to build* (ideas → MVPs → backlog →
sprints). This layer makes BuilderForce *build it*: autonomous agents that turn work items into
branches, PRs, refactors, tests, and reviews — closing the loop from idea to shipped code.

It is built **on the existing `api.builderforce.ai` gateway** (the same one BurnRateOS already
calls). The gateway owns model dispatch/failover; this layer owns the dev tooling, the work
graph, repo access, and the agent run lifecycle.

> Positioning: BuilderForce is "an agentic AI tool that provides software development **and**
> product management features." The PM/Agile pillars are the product-management half; this
> document is the software-development half. They share one work spine — the platform's `tasks`.
>
> **Unified onto the platform (operator decision 2026-09-12).** The entity names this PRD uses
> (`WorkItem`, `AgentRun`, `Repo`, …) are the spec's vocabulary, not tables to build. The spec's
> PM spine is unified onto `projects` / `tasks` / `specs`, and its agentic layer onto the existing
> `executions` / `workflows` / `source_control_integrations` stack (all already `segment_id`
> scoped). §2 is the mapping; read every entity name below through it. Doc 01 §4–§7 carries the
> field-level map.

---

## 1. Capabilities overview

| Agent kind | Trigger | Input | Output |
|------------|---------|-------|--------|
| **TRIAGE** | new/updated WorkItem | item + repo context | classification, plan, clarifying questions |
| **ESTIMATE** | poker assist / item open | item + repo | code-aware effort estimate, complexity |
| **IMPLEMENT** | "Assign to agent" on a card | item + repo + plan | branch + PR + diff summary |
| **REVIEW** | PR opened (own or human) | diff/PR | `CodeReviewFinding[]` + verdict |
| **REFACTOR** | retro finding / review finding | target files + goal | refactor PR |
| **TEST** | item / PR | code | generated/updated tests + run results |
| **RESEARCH** | discovery / spike | question | cited findings (feeds PM discovery) |

All runs are `executions` rows (the spec's `AgentRun`) with `execution_messages` / `tool_runs` for
live progress, Segment-scoped, and credit-metered through the gateway (`dev.*` use cases — doc 01
§8; spend lands in `llm_usage_log`).

---

## 2. Core entities → platform owners (doc 01 §4, §7)

No table in this PRD is new. Each spec entity is an existing platform row:

| Spec entity | Platform owner (id type) | Notes |
|---|---|---|
| `WorkItem` | `tasks` (`serial`, human `key`) | the ticket; `task_type` task / epic / bug / gap / …; `parent_task_id` nests |
| `Repo` | `source_control_integrations` (`serial`) + `project_repositories` (`uuid`) + `task_repo_bindings` | a ticket's repo is `tasks.explicit_repo_id` or its bindings; secrets live in `integration_credentials` / kernel `credentials`, **never** on the row |
| `AgentRun` | `executions` (`serial`, `task_id NOT NULL`, `segment_id`) | status pending / submitted / running / paused / completed / failed / cancelled; the run *kind* is the dispatching lane role (`submitted_by`) and agent (`cloud_agent_ref`), not a column |
| `AgentRunStep` | `execution_messages` + `tool_runs` / `tool_audit_events` + `telemetry_spans` | |
| `AgentOrchestration` | `workflows` + `workflow_tasks` (`uuid`, `segment_id`, `spec_id`) | policy = board `max_concurrent_tickets`, lane `gate`s, `execution_limits`, the autonomy circuit breaker |
| `CodeReviewFinding` | `task_reviews` (append-only verdicts) + `qa_findings` (`task_id`) + `vulnerability_findings` | a failed review mints a `gap` ticket |
| `ItemActivity` (`actorKind = AGENT`) | `task_status_transitions` (`actor_kind = 'agent'`) + kernel `activity_log` | |
| `Sprint`, `KanbanBoard` / column | `sprints`, `boards` / `swimlanes` | |

---

## 3. Repository connection

**User story.** As an eng lead, I connect a GitHub/GitLab repo to my Segment so agents can read
and open PRs.

**Flow**
1. OAuth/app-install handshake with the provider; store `Repo` (`status = CONNECTED`,
   `installationRef` → vault).
2. Detect languages/stack (populate `Repo.languages`).
3. Bind repos to projects: a project's repositories are `project_repositories` (its default is
   the project's `source_control_*` connection); tickets inherit it, overridable per ticket through
   `tasks.explicit_repo_id` or several repos through `task_repo_bindings`.

**API** (platform routes; the spec's `/v1/repos*` was never built as a parallel surface)
```
/api/integrations/*            provider connect (source_control_integrations + credentials)
/api/repos/*                   connected repositories (repoRoutes.ts)
/api/projects/*                project ↔ repository binding (project_repositories)
/api/tasks/:id                 the ticket's repo pin (tasks.explicit_repo_id) rides the task route
```

**Acceptance**
- Tokens never persisted in the DB; revoke on disconnect.
- A Segment can only act on repos it connected; agent file access is scoped to those repos.
- Least-privilege: request only the scopes needed (contents R/W, PRs); no org-wide admin.

---

## 4. The IMPLEMENT agent (idea → PR)

The flagship loop.

**User story.** As an eng lead, I click "Assign to dev agent" on a kanban card. An agent plans
the change, writes code on a branch, runs tests, and opens a PR linked back to the card — I
review and merge.

**Flow**
1. Create an `executions` row for the ticket (`task_id`; the repo resolved from
   `tasks.explicit_repo_id` / `task_repo_bindings` / the project default; use case
   `dev.implement`), status `pending`.
2. **Context assembly:** resolve the ticket (`tasks` title and description, plus its primary PRD
   through `task_specs` → `specs`, which carries the acceptance criteria and technical notes), pull
   relevant repo files (search + dependency graph), prior `executions` of the ticket, and the
   repo's conventions (lint/test config).
3. **Plan:** agent emits a step plan (`AgentRun.plan`); optionally gated on human approval per
   `AgentOrchestration.policy`.
4. **Execute:** agent works in an isolated workspace (per-run branch off the base). Each tool
   call is an `AgentRunStep` (`read_file`, `edit`, `run_tests`, `lint`, `open_pr`). Tests/lint run
   in a sandboxed runner.
5. **Deliver:** open a PR; set `tasks.git_branch` / `tasks.github_pr_url` (the run itself is
   `executions.task_id`); the lane move is a `task_status_transitions` row with
   `actor_kind = 'agent'`, and the ticket moves to its board's review lane.
6. **Human gate:** the card shows the PR + diff summary; a human (or a REVIEW agent) approves.
   Merge can be manual or auto per policy.

**API** (platform routes; the spec's `/v1/work-items/*` and `/v1/agent-runs/*` were never built as a
parallel surface)
```
POST   /api/tasks/:id/run-now                 run an agent on the ticket (creates the executions row)
GET    /api/runtime/executions                runs (filterable by ticket)
GET    /api/runtime/executions/:id            status + result
GET    /api/runtime/executions/:id/coordination   live coordination / steps
POST   /api/runtime/tasks/:id/cancel          cancel the ticket's run
```

**Realtime.** `agent-runs/:id` streams `step.started/finished`, `plan.ready`,
`run.status_changed` over the same realtime layer as poker/retro rooms (Segment-authorized).

**Acceptance**
- The agent never pushes to the base branch directly; always a feature branch + PR.
- Every file write is captured as an `AgentRunStep` (full audit; reconstructable diff).
- Token spend is metered per step and aggregated on the run; the run respects a per-run budget
  cap (from policy) and fails closed when exceeded.
- A failed test run is reported, not hidden; the run can retry or stop per policy.
- The ticket (`tasks`) stays the source of truth — the PR links back; merging the PR moves
  `tasks.status` through the SCM webhooks (`/api/webhooks`), and the ticket's first entry to a
  done-class lane emits `workitem.released` (doc 05 §4.3).

---

## 5. The REVIEW agent

**User story.** As an eng lead, when any PR opens (agent-authored or human), a review agent posts
findings.

**Flow**
1. Trigger on PR-opened webhook or manual `POST .../agent-run {kind:"REVIEW"}`.
2. Agent reads the diff + touched files + repo conventions → emits `CodeReviewFinding[]`
   (severity INFO/MINOR/MAJOR/BLOCKER; category BUG/SECURITY/PERF/STYLE/TEST) and a verdict.
3. Optionally post findings as PR comments via the provider API.
4. BLOCKER findings can gate auto-merge (policy).

**API**
```
POST   /v1/pull-requests/:ref/review        → dev.review
GET    /v1/agent-runs/:id/findings
PATCH  /v1/findings/:id                       resolve / dismiss
```

**Acceptance**
- Findings are deduplicated and reference exact `filePath`/`line`.
- The review verdict + blocker count are exposed to the orchestrator's auto-merge gate.
- Mirrors the spirit of BurnRateOS `/code-review`: adversarial, false-positive-averse.

---

## 6. The orchestrator (sprint → many PRs)

**User story.** As an eng lead, I run "Execute sprint": the orchestrator fans every committed
story out to IMPLEMENT agents in parallel, gated by review, within a budget cap.

**Flow**
1. Start a `workflows` run scoped to the sprint (`/api/workflows`).
2. The orchestrator enumerates eligible tickets (`tasks` with that `sprint_id`, a repo target, and
   no open predecessor in `task_dependencies`) and spawns `executions` up to the board's
   `max_concurrent_tickets`.
3. Each run flows through IMPLEMENT → REVIEW → (auto-merge | await human) per the lane `gate`s.
4. Dependency-aware: a ticket whose `task_dependencies` predecessors aren't merged waits.
5. Live dashboard: per-item agent status across the sprint board; aggregate token spend vs. cap.

**Policy** (the spec's `AgentOrchestration.policy`; on the platform these are the board's
`max_concurrent_tickets`, the lane `gate`s, `execution_limits` and the autonomy circuit breaker)
```jsonc
{
  "concurrency": 4,
  "autoApprovePlan": false,
  "autoMerge": "on_green_review",   // never | on_green_review | on_human_approve
  "reviewRequired": true,
  "blockerGate": true,               // BLOCKER findings stop merge
  "budgetCapTokens": 2000000,        // hard cap across all child runs
  "stopOnConsecutiveFailures": 3
}
```

**API** (platform routes)
```
/api/workflows/*               start / inspect / cancel a workflows run (workflowRoutes.ts)
POST /api/runtime/executions/cancel-all      stop every in-flight run
GET|PUT /api/runtime/execution-control       the tenant's execution kill switch
```

**Acceptance**
- Respects dependency order and concurrency; never exceeds the budget cap (fails closed).
- Pausing halts new runs but lets in-flight runs finish gracefully.
- Every child run is auditable and individually cancellable.

---

## 7. TRIAGE, ESTIMATE, REFACTOR, TEST, RESEARCH (supporting agents)

- **TRIAGE** — on item create/update: classify type/priority, draft acceptance criteria, surface
  clarifying questions, propose a plan. Writes back suggestions for human accept.
- **ESTIMATE** — code-aware effort: reads the repo to estimate complexity/effort; feeds poker
  `estimate-assist` and a `task_effort_estimates` row (`estimator_kind = 'agent'`, `task_id`).
- **REFACTOR** — fed by a retro action item or a REVIEW finding; targeted refactor PR.
- **TEST** — generate/extend tests for an item or PR; run them; report coverage delta.
- **RESEARCH** — answers a discovery/spike question with cited findings; output can feed PM
  Discovery (`pm.discovery.research`) or a `CustomerInsight`/`ValidationAIInsight`.

Each is an `executions` row dispatched by the corresponding lane role; same lifecycle, steps,
metering, and audit.

---

## 8. Safety, audit, and isolation (cross-cutting)

- **Segment isolation:** an agent's repo access, file reads, and writes are confined to the
  Segment's connected repos. Context assembly never crosses Segments.
- **Human-in-the-loop default:** v1 defaults to `autoMerge: never` and `autoApprovePlan: false`.
  Autonomy is opt-in per Segment via policy.
- **Full audit:** `executions` + `execution_messages` / `tool_audit_events` reconstruct every
  action, file touched, and token spent. `task_status_transitions` and `activity_log` record agent
  edits to tickets with `actor_kind = 'agent'`.
- **Budget:** per-run and per-orchestration token caps; the gateway's existing daily-budget
  breaker still applies. Credits are debited from the **Segment's** ledger.
- **Reversibility:** agents only ever propose via branch + PR; nothing reaches the base branch
  without the configured gate.
- **Secrets:** vault-only; never logged in steps; redacted from `inputContext` snapshots.

---

## 9. How this layer consumes the PM/Agile graph

```
product_ideas ──discovery──► RESEARCH agent (cited findings)
backlog ticket (tasks) ──"assign"──► TRIAGE → ESTIMATE → IMPLEMENT (executions) ──► branch + PR ──► REVIEW
sprints ──"execute"──► workflows run ──► many IMPLEMENT executions (task_dependencies-aware)
retro action_items ──promote (promoted_task_id)──► REFACTOR agent ──► PR
PR merged ──webhook──► tasks.status → done lane (emits workitem.released), velocity recorded, ROI actuals updated
```

This is the loop the whole product exists to close: **PM decides → Agile sequences → Agents
build → results flow back into PM/Agile metrics → next cycle.** It mirrors BurnRateOS's
"always think full cycle" principle, applied to the build process itself.

## 10. Phasing (within "full agentic" decision)

- **v1 (must-ship):** Repo connect, IMPLEMENT (branch+PR, human gate), REVIEW, run audit/steps,
  per-run budget, realtime progress.
- **v1.1:** Orchestrator (sprint fan-out), auto-merge policy, TEST agent.
- **v1.2:** TRIAGE/ESTIMATE wired into backlog & poker, REFACTOR from retros/findings, RESEARCH
  into discovery.
