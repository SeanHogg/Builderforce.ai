> **PRD** — drafted by Ada (Sr. Product Mgr) · task #526
> _Each agent that updates this PRD signs its change below._

# Generalist Coder Agent Provisioning for 50-Gap Coding Workstreams

## Problem & Goal
Bob Developer (V2 (Container)) is running at 85% utilization with sequential execution of 50 lingering gap-coding workstreams (GAP‑D*, GAP‑W*, GAP‑E*). This overload risk delays resolution of direct-messaging gaps, messaging encoding issues, and event handling gaps, pushing the delivery forecast to 64–78 days.

**Goal**: Repurpose the existing Bob agent as a Generalist Coder to execute the 50 gaps in parallel. This relieves Bob’s overload, cuts the gap‑coding timeline by ~30% (target: 38–48 days), and unblocks Project Health Scorecard / OKR dashboards. The agent’s OKR workload is capped at ~10 hours, well below the 50-hour threshold.

## Target Users / ICP Roles
- **Bob Developer (V2 (Container))** – the existing agent being reconfigured; serves as the internal executer, not an end‑user.
- **Engineering Team / Release Manager** – benefits from faster gap closure and dashboard readiness.
- **OKR/KR Tracking System** – consumes agent output to update progress dashboards.
- **Project Manager** – monitors parallel workstream health and delivery speed.

## Scope
- Reconfigure the existing **Bob Developer (V2 (Container))** agent (tenantId: 1, projectId: null) as a **Generalist Coder** with parallel execution of:
  - **GAP-D*** (direct-messaging gaps)
  - **GAP-W*** (messaging encoding issues)
  - **GAP-E*** (event handling gaps)
- Ensure the agent operates within the ~10‑hour OKR target.
- Deliver all gap-coding work within 38–48 days.
- Enable real‑time progress reporting to the Project Health Scorecard and OKR/KR dashboards.
- Maintain all current capabilities of the Bob agent; no degradation in quality or existing function.

## Functional Requirements
1. **Parallel Workstream Execution**  
   The agent must simultaneously process GAP‑D*, GAP‑W*, and GAP‑E* gaps, respecting any intra‑workstream dependencies defined in the product backlog.
2. **Pre‑Existing Agent Preservation**  
   The Bob agent’s existing configuration (V2, container) must remain unchanged except for the addition of parallel execution mode and the assignment of gap‑coding tasks.
3. **OKR Cap Enforcement**  
   Total agent activity (coding cycles + overhead) must not exceed ~10 hours of allocated OKR time; the system shall throttle or defer tasks if the limit is approached.
4. **Dashboard Integration**  
   Provide a structured status feed (e.g., per‑gap state, estimated completion) that updates the Project Health Scorecard and OKR/KR dashboards in near‑real time.
5. **Error & Retry Handling**  
   For gaps that fail coding, the agent must log a structured error, optionally retry up to 2 times, and escalate un‑resolvable issues to the human‑monitored queue.
6. **Utilization Relief**  
   Bob’s original sequential overload must fall below 70% within the first sprint after provisioning.

## Acceptance Criteria
- [ ] All 50 gaps (GAP‑D*, GAP‑W*, GAP‑E*) are coded and resolved within 38–48 calendar days from provisioning.
- [ ] Bob Developer’s utilization drops below 70% within one sprint.
- [ ] The agent’s consumed OKR time is ≤10 hours for the entire workstream.
- [ ] Project Health Scorecard shows “green” status for gap‑coding progress within 48 hours of provisioning.
- [ ] OKR/KR dashboards reflect accurate, automated updates for the gap‑coding KRs.
- [ ] No new agent instances are created; only the existing Bob agent is reconfigured.

## Out of Scope
- Provisioning of any new agent, infrastructure, or container images.
- Modifying the core Bob agent architecture (e.g., upgrading to V3, changing base capabilities).
- Handling gap categories outside GAP‑D*, GAP‑W*, GAP‑E* (e.g., UI‑specific gaps, performance gaps).
- Long‑term maintenance or retraining of the agent beyond the gap‑closure window.
- Human‑in‑the‑loop decision‑making for routine gap coding; manual intervention is only expected for escalated failures.

## Requirements

> **Author**: Business Analyst (task #526 — lane `backlog`) · signed 2026-08-03

### REQ-1: Agent Repurposing (Bob → Generalist Coder)

**REQ-1.1 — Identity Preservation**  
The existing agent record `d02ff7ee-9cf2-4c44-8558-c89104f6278f` ("Bob Developer (V2 (Container))") SHALL be retained as the sole provisioned resource. Its `ide_agents` row (tenantId=1, projectId=null, `runtimeSurface: "container"`, `engine: builderforce-v2`) MUST NOT be deleted or replaced; only its role assignment and execution mode SHALL be reconfigured.

**REQ-1.2 — Role Expansion**  
Bob's agent capabilities SHALL be augmented with the `generalist-coder` role, granting it access to the full gap-coding toolset: `read_file`, `write_file`, `edit_file`, `search_code`, `list_files`, `delete_file`. The existing V2 SDK tool surface (Read/Write/Edit/Bash/Glob/Grep via `claude-agent-sdk-runner.ts`) SHALL remain intact.

**REQ-1.3 — Parallel Execution Mode**  
Bob SHALL be reconfigured from sequential (`maxConcurrentExecutions: 1`) to parallel execution (`maxConcurrentExecutions ≥ 3`), one per gap workstream family (GAP-D*, GAP-W*, GAP-E*). The concurrency ceiling MUST respect the per-tenant concurrent-execution limit (GAP-D8) to avoid fan-out storms.

**REQ-1.4 — Skills Manifest**  
Bob's `skills` array SHALL be updated to include `["coding-agent", "code-reviewer", "test-generator", "gap-resolution"]`. The `bio` field SHALL be updated to: _"Generalist Coder — resolves gap-coding workstreams across dispatch, workspace, and engine domains. V2 container runtime with parallel execution."_

### REQ-2: Gap Workstream Assignment

**REQ-2.1 — Workstream Partitioning**  
The 50 gaps defined in `specs/builderforce/09-prd-cloud-agent-validation.md` §4 SHALL be partitioned into three parallel workstreams:

| Workstream | Gap Family | Count | Source (§4) | Description |
|---|---|---|---|---|
| WS-D | GAP-D1…D8 | 8 | §4.A | Dispatch, engine selection & routing |
| WS-W | GAP-W1…W12 | 12 | §4.B | Workspace, git & PR lifecycle |
| WS-E | GAP-E1…E8 | 8 | §4.C | Engine behaviour & parity |
| *(follow-on)* | GAP-S1…S7, GAP-O1…O7, GAP-B1…B4, GAP-G1…G3, GAP-V1 | 22 | §4.D–H | Steering, observability, billing, security, harness |

**REQ-2.2 — Priority Ordering**  
Within each workstream, gaps SHALL be processed in severity order: P0 first, then P1, then P2. For same-severity gaps, the numeric order in the spec SHALL govern (e.g., GAP-D1 before GAP-D2).

**REQ-2.3 — Intra-Workstream Dependencies**  
Gaps that depend on shared infrastructure (e.g., GAP-W1 workspace cloning → GAP-W2 teardown-on-error, GAP-D1 engine resolution → GAP-D3 engine snapshot) SHALL be sequenced such that the foundational gap is resolved before its dependent. Dependency edges SHALL be recorded via `builtin_tasks_add_dependency` on the board.

**REQ-2.4 — Dependency Bridging Across Workstreams**  
Cross-workstream dependencies SHALL be honoured: GAP-O* (observability) gaps depend on dispatch (GAP-D*) and workspace (GAP-W*) gaps being resolved first for the telemetry contract to be testable. GAP-G* (security) depends on engine parity (GAP-E*) for the isolation model to be assessed. These SHALL be captured as blocking edges on the board.

### REQ-3: OKR & Budget Enforcement

**REQ-3.1 — Time Cap**  
Bob's total agent activity (coding cycles + tool-call overhead + commit/push latency) across all 50 gaps MUST NOT exceed 10 hours of allocated OKR time. This SHALL be enforced by the pre-flight budget check (GAP-B3) — a run SHALL be reserve-estimated before dispatch, and SHALL be throttled or deferred if the remaining budget falls below the estimated cost of the next gap.

**REQ-3.2 — Budget Tracking**  
Every execution SHALL be attributable to the gap it targets via `execution_id` → `llm_usage_log`. The cumulative token spend per workstream SHALL be queryable and surfaced to the Project Health Scorecard. Budget consumption SHALL be reported in the OKR/KR dashboard at per-gap granularity.

**REQ-3.3 — BYO Key Routing**  
Bob's V2 inference SHALL route through the tenant's BYO Anthropic key via `tenantProviderKeyService` (capability C11). If the BYO key is missing or invalid, the run SHALL fail closed (GAP-B2, GAP-B4) — no silent fallback to the platform-billed default key.

**REQ-3.4 — Utilization Target**  
Bob's pre-provisioning sequential utilization (claimed 85%) SHALL drop below 70% within one sprint (2 weeks) of provisioning. This SHALL be measured as: (active execution minutes ÷ available agent minutes) per sprint, sourced from `usage_snapshots`.

### REQ-4: Dashboard Integration

**REQ-4.1 — Project Health Scorecard Feed**  
A structured status feed SHALL be emitted per gap, carrying:
- `gapId` (e.g., `GAP-D1`)
- `status` (`pending` | `in_progress` | `resolved` | `failed` | `escalated`)
- `engine` (`builderforce-v2`)
- `executionId` (for telemetry join)
- `estimatedCompletion` (ISO 8601 timestamp)
- `retryCount` (0–2)

The feed SHALL update within 5 minutes of any status transition.

**REQ-4.2 — OKR/KR Dashboard Updates**  
Key Results tracking gap-closure velocity SHALL receive automated updates when a gap transitions to `resolved` or `failed`. The KR metric SHALL be `gaps_resolved / 50` expressed as a percentage, updated within 5 minutes of each resolution.

**REQ-4.3 — Green Status Threshold**  
The Project Health Scorecard SHALL display "green" for gap-coding progress when: ≥10 gaps are resolved within the first 48 hours of provisioning, AND the resolved rate sustains the 38–48 day delivery trajectory (≥1.04 gaps/day). "Amber" at 0.7–1.03 gaps/day; "Red" below 0.7 gaps/day.

### REQ-5: Error, Retry & Escalation

**REQ-5.1 — Structured Error Logging**  
Every gap-coding failure SHALL produce a structured error record with:
- `gapId`
- `executionId`
- `errorKind` (`tool_failure` | `budget_exceeded` | `provider_error` | `timeout` | `conflict` | `validation_failure`)
- `phase` (dispatch | clone | work | finalize | teardown)
- `detail` (human-readable diagnostic)
- `timestamp`

Errors SHALL be written to the execution's telemetry ledger (`tool_audit_events` with a distinct `error` event kind) so they are reconstructable (GAP-O1).

**REQ-5.2 — Automatic Retry**  
For transient failures (`provider_error`, `timeout`), the system SHALL retry the gap automatically up to 2 times before escalating. Retries SHALL reset the workspace to a clean state (GAP-W1 branch reset/fast-forward, GAP-W2 workspace teardown on error). A gap that succeeds on retry SHALL mark the prior failed executions as superseded.

**REQ-5.3 — Escalation to Human Queue**  
A gap that fails all 3 attempts (original + 2 retries) SHALL be escalated to the human-monitored queue with the full error record. The ticket SHALL be moved to a `needs_triage` lane and SHALL carry the accumulated error log. No further automated attempts SHALL be made on that gap without human acknowledgement.

**REQ-5.4 — No-Changes Handling**  
If Bob runs against a gap and produces zero file changes (empty diff), the execution SHALL be marked `no_changes` (GAP-W5) and SHALL NOT open an empty PR. The gap SHALL be flagged for human review — it may indicate that the gap is already resolved, mis-scoped, or requires a different agent capability.

### REQ-6: Execution & Lifecycle Integrity

**REQ-6.1 — Engine Immutability Per Execution**  
Bob's engine (`builderforce-v2`) SHALL be resolved once at dispatch and SHALL be immutable for the lifetime of the execution. The engine SHALL be snapshotted onto the execution row (GAP-D3) so a post-hoc audit can determine which engine produced each outcome.

**REQ-6.2 — Workspace Hygiene**  
Every execution SHALL clean up its workspace on termination (success, error, or cancel) — no `.builderforce/tasks/<taskId>` leak (GAP-W2). Teardown SHALL run in a `finally` block or equivalent terminal-state handler.

**REQ-6.3 — Re-Run Safety**  
A re-run of the same gap ticket SHALL reset or fast-forward the workspace branch to the current base, NOT duplicate it (GAP-W1). Consecutive runs on the same ticket SHALL be idempotent with respect to workspace state.

**REQ-6.4 — Diff Attribution**  
All file changes produced by Bob SHALL be attributed to `cloud_agent_ref: d02ff7ee-9cf2-4c44-8558-c89104f6278f` and scoped to the correct `execution_id`. The attribution chain SHALL be reconstructable from `tool_audit_events` + `usage_snapshots` + `llm_usage_log` joined on `execution_id` (GAP-O1).

**REQ-6.5 — Empty-Diff & Conflict Signaling**  
PRs opened by Bob SHALL carry a mergeability signal (GAP-W6). A PR that cannot be merged due to base divergence SHALL surface `mergeable_state: dirty` on the execution record, not fail silently.

### REQ-7: Validation & Acceptance Gates

**REQ-7.1 — Golden-Path E2E (Pre-Flight)**  
Before any gap-coding run is dispatched, a single golden-path E2E SHALL validate the Bob agent end-to-end: dispatch → clone → produce a file change → finalize → open PR → reconstruct from telemetry → teardown. This SHALL pass (engine V2) before the gap workstreams are launched.

**REQ-7.2 — Per-Workstream Smoke Test**  
After the first gap in each workstream (WS-D, WS-W, WS-E) is resolved, a smoke test SHALL verify: the gap's acceptance criterion (from §4 of the spec) is demonstrably satisfied, the PR is mergeable, and the telemetry is reconstructable.

**REQ-7.3 — Continuous Validation**  
The `pnpm qa:cloud-agents` harness (GAP-V1) SHALL be wired and passing for the V2 engine path before any gap is marked `resolved`. It SHALL be re-run after every 10 gap resolutions as a regression gate.

**REQ-7.4 — Sign-Off Gates**  
Each resolved gap SHALL record a sign-off from the Validator agent (acceptance review) before the gap ticket transitions to Done. The sign-off SHALL reference the execution that produced the resolution.

### Traceability Matrix

| Functional Requirement | Maps to Requirements | Maps to Gaps |
|---|---|---|
| FR1: Parallel Workstream Execution | REQ-1.3, REQ-2.1, REQ-2.3 | GAP-D*, GAP-W*, GAP-E* |
| FR2: Pre-Existing Agent Preservation | REQ-1.1, REQ-1.2, REQ-1.4 | — |
| FR3: OKR Cap Enforcement | REQ-3.1, REQ-3.2, REQ-3.3 | GAP-B2, GAP-B3, GAP-B4 |
| FR4: Dashboard Integration | REQ-4.1, REQ-4.2, REQ-4.3 | GAP-O1, GAP-O2, GAP-O5, GAP-O6 |
| FR5: Error & Retry Handling | REQ-5.1, REQ-5.2, REQ-5.3, REQ-5.4 | GAP-D4, GAP-W2, GAP-W5 |
| FR6: Utilization Relief | REQ-3.4 | GAP-D8 |

### Key Assumptions

1. **Bob is available and active.** The agent record `d02ff7ee-9cf2-4c44-8558-c89104f6278f` exists, is `status: active`, and is dispatchable. Verified via `cloud_agents_list_mine` at provisioning time.
2. **The 50 gaps are stable.** The gap definitions in `09-prd-cloud-agent-validation.md` are the canonical source. Gaps added or re-scoped after provisioning are out-of-scope for this 10-hour budget.
3. **Tenant BYO key is provisioned.** Bob's V2 inference requires a valid, decryptable BYO Anthropic key for tenant 1. If missing, this is a blocker — REQ-3.3 fails closed.
4. **Concurrent execution capacity exists.** The per-tenant concurrent-execution limit (GAP-D8) must accommodate ≥3 simultaneous Bob runs. If the current cap is 1, it SHALL be raised to ≥3 as part of provisioning.
5. **Validator agent is available for sign-off.** Each resolved gap requires Validator acceptance (REQ-7.4). The Validator agent (`validator-t1`) must be dispatchable.
6. **38–48 day target assumes no blocking P0 gaps.** The timeline is achievable if Bob resolves ≥1.04 gaps/day. P0 gaps that require infrastructure changes (GAP-G1 sandbox, GAP-E2 command policy) may delay the workstream and SHALL be surfaced immediately.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._