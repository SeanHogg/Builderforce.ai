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
> document is the software-development half. They share the `WorkItem` spine.

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

All runs are `AgentRun` rows with `AgentRunStep[]` for live progress, Segment-scoped, and
credit-metered through the gateway (`dev.*` use cases — doc 01 §8).

---

## 2. Core entities (recap from doc 01 §7)

`Repo`, `AgentRun`, `AgentRunStep`, `AgentOrchestration`, `CodeReviewFinding`. Secrets
(installation tokens, deploy keys) are stored in a vault keyed by `Repo.id`, **never** in the DB
row — the row holds only a `installationRef` pointer.

---

## 3. Repository connection

**User story.** As an eng lead, I connect a GitHub/GitLab repo to my Segment so agents can read
and open PRs.

**Flow**
1. OAuth/app-install handshake with the provider; store `Repo` (`status = CONNECTED`,
   `installationRef` → vault).
2. Detect languages/stack (populate `Repo.languages`).
3. Bind repos to boards/projects: a `KanbanBoard` or `ProductIdea` can declare a default
   `repoRef`; WorkItems inherit it (overridable per item).

**API**
```
POST   /v1/repos/connect          start provider install/oauth
GET    /v1/repos                  list connected repos
GET    /v1/repos/:id              detail + detected stack
DELETE /v1/repos/:id              disconnect (revoke token in vault)
PUT    /v1/work-items/:id/repo    set target repoRef + branch base
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
1. Create `AgentRun(kind=IMPLEMENT, workItemId, repoId, useCase="dev.implement", goal=<item
   acceptance criteria + description>)`, status `QUEUED`.
2. **Context assembly:** resolve the WorkItem (title, description, `acceptanceCriteria`,
   `userType/want/so`, `technicalNotes`), pull relevant repo files (search + dependency graph),
   prior `AgentRun`s on the item, and the repo's conventions (lint/test config). Store in
   `inputContext`.
3. **Plan:** agent emits a step plan (`AgentRun.plan`); optionally gated on human approval per
   `AgentOrchestration.policy`.
4. **Execute:** agent works in an isolated workspace (per-run branch off the base). Each tool
   call is an `AgentRunStep` (`read_file`, `edit`, `run_tests`, `lint`, `open_pr`). Tests/lint run
   in a sandboxed runner.
5. **Deliver:** open a PR; store `branch`, `prUrl`, `diffSummary`; set WorkItem
   `generatedBranch`/`generatedPrUrl`/`agentRunId`; write `ItemActivity` (`actorKind = AGENT`).
   Status → `AWAITING_REVIEW`.
6. **Human gate:** the card shows the PR + diff summary; a human (or a REVIEW agent) approves.
   Merge can be manual or auto per policy.

**API**
```
POST   /v1/work-items/:id/agent-run        { kind:"IMPLEMENT", autoApprovePlan?, repoId? }
GET    /v1/agent-runs/:id                   status + plan + diffSummary
GET    /v1/agent-runs/:id/steps             live steps (also via realtime stream)
POST   /v1/agent-runs/:id/approve-plan
POST   /v1/agent-runs/:id/cancel
GET    /v1/work-items/:id/agent-runs        history for an item
```

**Realtime.** `agent-runs/:id` streams `step.started/finished`, `plan.ready`,
`run.status_changed` over the same realtime layer as poker/retro rooms (Segment-authorized).

**Acceptance**
- The agent never pushes to the base branch directly; always a feature branch + PR.
- Every file write is captured as an `AgentRunStep` (full audit; reconstructable diff).
- Token spend is metered per step and aggregated on the run; the run respects a per-run budget
  cap (from policy) and fails closed when exceeded.
- A failed test run is reported, not hidden; the run can retry or stop per policy.
- WorkItem stays the source of truth — the PR links back; merging the PR can transition the
  item's `status`/`stage` via webhook (doc 05 §4.3).

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
1. `POST /v1/orchestrations { scopeType:"SPRINT", scopeId, policy }`.
2. Orchestrator enumerates eligible WorkItems (committed, has repo target, not blocked by an
   open dependency) and spawns child `AgentRun`s up to `policy.concurrency`.
3. Each run flows through IMPLEMENT → REVIEW → (auto-merge | await human) per policy.
4. Dependency-aware: an item whose `dependencies` aren't merged waits.
5. Live dashboard: per-item agent status across the sprint board; aggregate token spend vs. cap.

**Policy** (`AgentOrchestration.policy`)
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

**API**
```
POST   /v1/orchestrations
GET    /v1/orchestrations/:id          aggregate status + child runs + spend
POST   /v1/orchestrations/:id/pause | /resume | /cancel
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
  `estimate-assist` and `WorkItem.effort`/`estimatedHours`.
- **REFACTOR** — fed by a retro action item or a REVIEW finding; targeted refactor PR.
- **TEST** — generate/extend tests for an item or PR; run them; report coverage delta.
- **RESEARCH** — answers a discovery/spike question with cited findings; output can feed PM
  Discovery (`pm.discovery.research`) or a `CustomerInsight`/`ValidationAIInsight`.

Each is an `AgentRun` of the corresponding `kind`; same lifecycle, steps, metering, and audit.

---

## 8. Safety, audit, and isolation (cross-cutting)

- **Segment isolation:** an agent's repo access, file reads, and writes are confined to the
  Segment's connected repos. Context assembly never crosses Segments.
- **Human-in-the-loop default:** v1 defaults to `autoMerge: never` and `autoApprovePlan: false`.
  Autonomy is opt-in per Segment via policy.
- **Full audit:** `AgentRun` + `AgentRunStep` reconstruct every action, file touched, and token
  spent. `ItemActivity` records agent edits to work items with `actorKind = AGENT`.
- **Budget:** per-run and per-orchestration token caps; the gateway's existing daily-budget
  breaker still applies. Credits are debited from the **Segment's** ledger.
- **Reversibility:** agents only ever propose via branch + PR; nothing reaches the base branch
  without the configured gate.
- **Secrets:** vault-only; never logged in steps; redacted from `inputContext` snapshots.

---

## 9. How this layer consumes the PM/Agile graph

```
ProductIdea ──discovery──► RESEARCH agent (cited findings)
Backlog WorkItem ──"assign"──► TRIAGE → ESTIMATE → IMPLEMENT ──► branch + PR ──► REVIEW
Sprint ──"execute"──► AgentOrchestration ──► many IMPLEMENT runs (dependency-aware)
Retro ActionItem ──"convert + fix"──► REFACTOR agent ──► PR
PR merged ──webhook──► WorkItem.status→DONE, velocity recorded, ROI actuals updated
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
