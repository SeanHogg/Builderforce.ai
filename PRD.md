> **PRD** — drafted by Mike QA (Tester V2 (Durable) · task #135
> _Each agent that updates this PRD signs its change below._

# PRD: CoderClaw Runtime Parity — Agentic Coding Experience

**Status:** WIP | **OKR:** Product Quality — OKR 2 | **Owner:** Product Architecture

---

## 1. Problem & Goal

### Problem
CoderClaw users experience a fragmented, opaque agentic coding workflow: tasks run as black boxes, there is no recovery path when an agent step goes wrong, and the system lacks the flexibility to route subtasks to the most cost-effective or capable model. This erodes trust, increases churn, and blocks conversion of trial users to paid seats.

### Goal
Deliver a best-in-class agentic coding runtime that gives users real-time visibility into what the agent is doing, granular control over execution, seamless recovery from mistakes, and intelligent model utilization — reaching parity with (and exceeding) leading competitors on observable, controllable, and efficient agentic execution.

### Success Metrics
| Metric | Baseline | Target |
|---|---|---|
| 7-day retention (coding users) | TBD | +15 pp |
| Trial → Paid conversion | TBD | +10 pp |
| Mean task abandon rate | TBD | −25% |
| P95 first-token latency (streaming) | TBD | ≤ 800 ms |
| User-reported "I trust the agent" NPS driver | TBD | Top 3 driver |

---

## 2. Target Users / ICP Roles

| Role | Description | Primary Pain |
|---|---|---|
| **Solo Developer** | Individual building side projects or freelancing; uses CoderClaw as a pair programmer | No recovery when agent goes off-rails; can't see what step failed |
| **Engineering Lead** | Manages a small team; delegates subtasks to the agent | Cannot audit which model or step produced a bad output |
| **Staff / Principal Engineer** | High-output engineer integrating CoderClaw into existing workflows | Needs model flexibility to control cost vs. quality tradeoff per step |
| **Growth / DevRel** | Evaluates CoderClaw for team adoption | Needs live demos that are visually compelling and trustworthy |

---

## 3. Scope

### In Scope (this OKR cycle)
1. Orchestration Workspace Live UI (DAG + real-time task status)
2. Inline Diff / Pair Programming Mode
3. Session Auto-Checkpoint (auto-save, `/undo`, `/fork`)
4. Remote Task Result Streaming
5. Multi-Model Role Routing (per-step model assignment)

### Release Boundary
All five capabilities must ship together as a cohesive runtime release. Partial shipping of individual features is permitted only as staged rollout behind feature flags, not as independent GA releases.

---

## 4. Functional Requirements

### 4.1 Orchestration Workspace — Live DAG UI

**FR-1.1** The UI must render a directed acyclic graph (DAG) of the current agent plan immediately after the agent decomposes a task, before any step begins execution.

**FR-1.2** Each DAG node must display: step name, assigned model, current status (`pending` | `running` | `done` | `failed` | `skipped`), and elapsed/estimated duration.

**FR-1.3** Node status must update in real time (≤ 500 ms from server event to UI render) without a full page reload.

**FR-1.4** Users must be able to click any node to expand a detail panel showing: full prompt sent, raw model output, tool calls made, tokens consumed, and cost estimate.

**FR-1.5** The DAG must support both sequential and parallel step layouts and correctly render fan-out/fan-in branching.

**FR-1.6** Users must be able to manually mark a failed node for retry or skip directly from the DAG UI.

---

### 4.2 Inline Diff / Pair Programming Mode

**FR-2.1** When the agent proposes a file change, the UI must render a side-by-side or unified diff view inline within the conversation/workspace, not as a modal or separate page.

**FR-2.2** Users must be able to accept, reject, or partially accept (hunk-level) each proposed change without leaving the inline view.

**FR-2.3** Accepted changes must be applied to the working file immediately and reflected in the file tree/editor within 300 ms.

**FR-2.4** The diff view must support syntax highlighting for all languages in the existing CoderClaw language matrix.

**FR-2.5** Users must be able to edit a proposed hunk directly in the diff view before accepting it (the agent's suggestion becomes a base; the user has the last word).

**FR-2.6** Each diff block must display the originating agent step and model so users know the provenance of every change.

---

### 4.3 Session Auto-Checkpoint

**FR-3.1** The system must automatically save a checkpoint of the full session state (conversation history, file working tree snapshot, DAG state, model assignments) after every completed agent step.

**FR-3.2** `/undo` command must restore the session to the most recent checkpoint, reverting both conversation context and file changes made during that step.

**FR-3.3** `/undo N` must support stepping back N checkpoints (N ≤ 20 within a single session).

**FR-3.4** `/fork` command must create a new named session branch from the current checkpoint, preserving the original branch untouched.

**FR-3.5** Users must be able to list and navigate checkpoint history via a timeline UI panel, not only via slash commands.

**FR-3.6** Checkpoints must persist for a minimum of 7 days for free-tier users and 90 days for paid users, stored server-side (client-side storage alone is not acceptable).

**FR-3.7** Checkpoint save must not block the UI; it must complete asynchronously with a visible save indicator.

---

### 4.4 Remote Task Result Streaming

**FR-4.1** All agent step outputs — text, tool call results, file diffs, log lines — must be streamed token-by-token (or chunk-by-chunk for binary artifacts) from the server to the client in real time.

**FR-4.2** Streaming must use a persistent connection (SSE or WebSocket); polling is not acceptable for primary delivery.

**FR-4.3** The system must gracefully resume streaming after a client network interruption without losing tokens already delivered; partial output must be preserved on reconnect.

**FR-4.4** P95 time-to-first-token for any streamed step must be ≤ 800 ms from task dispatch.

**FR-4.5** Long-running remote tasks (> 60 s) must support background execution: the user can navigate away and return to a live-updated result without the task being cancelled.

**FR-4.6** The client must display a real-time throughput indicator (tokens/s or KB/s) during active streaming.

---

### 4.5 Multi-Model Role Routing

**FR-5.1** Each step in the DAG must carry an explicit model assignment, defaulting to a system-configured routing policy but overridable by the user per step.

**FR-5.2** The system must ship with at least three built-in routing policy presets: `cost-optimized`, `quality-optimized`, and `balanced`.

**FR-5.3** Users must be able to define a custom routing rule that maps step types (e.g., `planning`, `code-generation`, `test-writing`, `review`, `summarization`) to specific model identifiers.

**FR-5.4** Routing rules must support model fallback chains: if the primary model is unavailable or rate-limited, the system automatically routes to the next model in the chain without surfacing an error to the user.

**FR-5.5** The assigned model and estimated cost per step must be visible before the step executes, giving users the opportunity to change the assignment.

**FR-5.6** Routing configuration must be exportable and importable as a JSON or YAML file for team-level standardization.

**FR-5.7** The system must log the actual model used per step (not just the assigned model) to the checkpoint record, ensuring auditability when fallbacks occur.

---

## 5. Acceptance Criteria

### Epic-Level Gates (all must pass before GA)

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | DAG renders within 1 s of agent plan generation with correct node topology | Automated E2E test + manual QA on 5 representative task types |
| AC-2 | Node status updates arrive at UI in ≤ 500 ms of server-side state change | Latency instrumentation test with synthetic clock |
| AC-3 | Inline diff accept/reject/partial-accept cycle completes without page navigation | E2E test covering 10 file types |
| AC-4 | `/undo` restores conversation and file tree to pre-step state with zero data loss | Automated regression suite: 50 undo scenarios |
| AC-5 | `/fork` creates an independent branch; changes to fork do not affect origin | Automated branch isolation test |
| AC-6 | Checkpoints persist server-side and survive browser refresh + 24 h gap | Integration test + manual validation |
| AC-7 | Streaming resumes correctly after simulated 10 s network drop; no tokens lost | Chaos test with network partition injection |
| AC-8 | P95 time-to-first-token ≤ 800 ms under 100 concurrent sessions | Load test in staging environment |
| AC-9 | Background task survives user navigation and delivers complete result on return | E2E test: navigate away at t=5 s, return at t=90 s |
| AC-10 | Custom routing rule correctly assigns models per step type across 3 routing presets | Unit + integration tests for routing engine |
| AC-11 | Model fallback activates silently when primary is rate-limited; user sees no error | Fault injection test against mock model endpoint |
| AC-12 | All five features operate correctly behind feature flags with no cross-contamination | Feature flag integration test matrix |

---

## 6. Out of Scope

- **Voice / audio interfaces** for pair programming or task dictation
- **IDE plugins** (VS Code, JetBrains) — runtime parity ships in the CoderClaw web workspace only in this cycle
- **Multi-user real-time collaboration** on the same session (multiplayer cursors, shared editing)
- **Agent-initiated web browsing or external API calls** beyond what the existing tool layer already supports
- **Custom model fine-tuning or BYOM (Bring Your Own Model) training pipelines** — routing supports calling external model endpoints but not training
- **Billing and quota enforcement UI** changes beyond surfacing per-step cost estimates already required by FR-5.5
- **Mobile native apps** — responsive web only
- **Checkpoint-to-Git integration** (export session checkpoints as Git commits) — deferred to OKR 3
- **Cross-session search** over checkpoint history — deferred to OKR 3
- **Compliance / audit log export** (SOC 2, HIPAA artifact generation) — deferred to a dedicated compliance workstream

---

*Last updated by Product Architecture. All downstream engineering, design, and QA agents should treat this document as the authoritative specification for OKR 2 scope. Changes require Product Owner sign-off and a dated revision entry below.*

### Revision History
| Date | Author | Summary |
|---|---|---|
| — | Product Architecture | Initial WIP draft |