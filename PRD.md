> **PRD** — drafted by Ada (Sr. Product Mgr) · task #212
> _Each agent that updates this PRD signs its change below._

# PRD: Agent Workflow Bottleneck Identification System

## Problem & Goal

Multi-agent pipelines stall silently. Tasks queue behind human-review gates, fall into capability gaps no agent covers, or cycle indefinitely when handoff logic is undefined. Without systematic visibility into *where* and *why* work stops, teams cannot improve throughput, SLA compliance, or agent coverage.

**Goal:** Build an analysis layer that continuously identifies, classifies, and surfaces two categories of bottlenecks in agent workflows:
1. **Human-gating bottlenecks** — tasks blocked waiting for human review, approval, or input.
2. **Coverage gaps** — tasks that no currently deployed agent has the capability to handle.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **AI/Automation Engineer** | Pinpoint which pipeline stages need new agents or expanded capabilities |
| **Engineering Manager** | Quantify human-review load and justify automation investment |
| **Product Manager** | Understand where SLAs are at risk due to workflow stalls |
| **Agent Developer** | Receive structured gap reports to scope new agent builds |

---

## Scope

This PRD covers the **detection, classification, and reporting** of bottlenecks within an existing multi-agent orchestration environment. It does not cover remediation (building new agents or redesigning workflows) except in the form of actionable recommendations output.

---

## Functional Requirements

### FR-1: Workflow Instrumentation
- **FR-1.1** Ingest task/event logs from the orchestration layer (queue timestamps, agent assignment records, status transitions, escalation events).
- **FR-1.2** Instrument every task state transition with: `task_id`, `timestamp`, `from_state`, `to_state`, `assigned_agent` (or `null`), `escalation_reason`.
- **FR-1.3** Support at minimum two log source formats: structured JSON event streams and relational task-table exports.

### FR-2: Human-Review Wait Detection
- **FR-2.1** Detect tasks that transition into a `PENDING_HUMAN`, `AWAITING_APPROVAL`, or equivalent paused state.
- **FR-2.2** Calculate and store `human_wait_duration` = time elapsed from pause state entry to resolution or current timestamp.
- **FR-2.3** Flag tasks whose `human_wait_duration` exceeds a configurable threshold (default: 1 hour).
- **FR-2.4** Aggregate human-gating events by: workflow stage, task type, time window, and the identity of the reviewing human role.
- **FR-2.5** Distinguish *mandatory* human review (by design) from *fallback* human review (agent failed or lacked confidence) and report both separately.

### FR-3: Coverage Gap Detection
- **FR-3.1** Maintain a **capability registry** — a structured map of `{agent_id → [capability_tags]}` for all deployed agents.
- **FR-3.2** On every task arrival, evaluate whether at least one agent in the registry matches the task's required capability tags.
- **FR-3.3** If no capable agent is found, classify the task as a **coverage gap** and record: `task_type`, `required_capabilities`, `frequency`, `first_seen`, `last_seen`.
- **FR-3.4** Track gap recurrence: if the same uncovered task type appears ≥ N times (configurable, default: 5) within a rolling window (default: 24 hours), escalate to a **critical gap alert**.
- **FR-3.5** Distinguish between *hard gaps* (no agent exists) and *soft gaps* (agent exists but is at capacity or unavailable).

### FR-4: Bottleneck Scoring & Prioritization
- **FR-4.1** Compute a **Bottleneck Severity Score (BSS)** per identified bottleneck using: frequency × average delay × downstream task impact (tasks blocked as a consequence).
- **FR-4.2** Rank all active bottlenecks by BSS in descending order.
- **FR-4.3** Attach a structured recommendation to each bottleneck: `{bottleneck_type, affected_stage, suggested_action, estimated_impact}`.

### FR-5: Reporting & Alerting
- **FR-5.1** Provide a real-time dashboard view: active human-gated tasks, open coverage gaps, top-5 bottlenecks by BSS.
- **FR-5.2** Emit alerts (webhook, email, or Slack) when: a critical gap alert is triggered, a human-wait duration breaches threshold, or BSS for any bottleneck crosses a configurable severity ceiling.
- **FR-5.3** Generate a scheduled **Bottleneck Summary Report** (daily by default) in both JSON (machine-readable) and Markdown (human-readable) formats.
- **FR-5.4** Expose all findings via a read-only REST API (`GET /bottlenecks`, `GET /gaps`, `GET /human-waits`) for downstream tooling consumption.

### FR-6: Configuration & Calibration
- **FR-6.1** All thresholds (wait duration, gap recurrence count, rolling window, BSS ceiling) must be configurable via a single config file or environment variables without code changes.
- **FR-6.2** Capability registry must be updatable at runtime without restarting the analysis service.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a task log containing 10 tasks in `PENDING_HUMAN` state for > 1 hour, the system surfaces all 10 in the human-wait report within 5 minutes of log ingestion. |
| AC-2 | Given a task type with required capability `invoice_parsing` absent from the capability registry, the system classifies it as a coverage gap and records it on first occurrence. |
| AC-3 | Given the same uncovered task type appearing 5 times in 24 hours, a critical gap alert is emitted to all configured notification channels. |
| AC-4 | BSS is computed for all active bottlenecks; the ranked list updates within 60 seconds of new event ingestion. |
| AC-5 | The daily Markdown report is generated and delivered by 00:05 UTC and contains all bottlenecks active in the prior 24-hour window. |
| AC-6 | `GET /bottlenecks` returns HTTP 200 with a JSON array sorted by BSS descending; response time < 500 ms at P95 under 100 concurrent requests. |
| AC-7 | Changing the `human_wait_threshold` config value and reloading config applies the new threshold to all subsequent evaluations without service restart. |
| AC-8 | Mandatory vs. fallback human-review classifications match ground-truth labels in a labeled test dataset with ≥ 95% accuracy. |

---

## Out of Scope

- **Automated remediation** — the system recommends actions but does not autonomously reassign tasks, spin up new agents, or modify workflow routing rules.
- **Agent performance optimization** — latency or quality issues within a capable, assigned agent are not bottlenecks under this definition and are handled by separate monitoring tooling.
- **Workflow redesign tooling** — no drag-and-drop or visual workflow editor is included.
- **Agent capability development** — defining what new agents should do or building them is outside this system's responsibility.
- **Authentication / authorization management** — access control for human reviewers is assumed to be handled by the upstream orchestration platform.
- **Cross-organization benchmarking** — comparison of bottleneck metrics against external industry data is not included in v1.