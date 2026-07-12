> **PRD** — drafted by Ada (Sr. Product Mgr) · task #217
> _Each agent that updates this PRD signs its change below._

# PRD: Bottleneck Identification System — Human Review & Agent Capability Gaps

## Problem & Goal

AI-assisted workflows frequently stall or degrade in quality at points where human judgment is required or where agent capabilities are insufficient. These bottlenecks are rarely surfaced explicitly — they manifest as latency spikes, repeated retries, low-confidence outputs, escalations, or silent failures. Without systematic identification and categorization of these friction points, product and engineering teams cannot prioritize improvements, training investments, or workflow redesigns.

**Goal:** Build a bottleneck identification system that continuously detects, classifies, and surfaces workflow friction points attributable to either human review requirements or agent capability gaps — and provides actionable data to drive resolution.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **AI Product Manager** | Prioritize agent improvement roadmap based on real bottleneck frequency and business impact |
| **ML / AI Engineer** | Diagnose specific capability gaps (e.g., tool misuse, context window failures, reasoning errors) to target fine-tuning or retrieval improvements |
| **Workflow / Process Designer** | Redesign human-in-the-loop touchpoints based on evidence of where human review is genuinely necessary vs. unnecessary |
| **Operations Lead** | Monitor SLA compliance and identify systemic delays caused by unresolved bottlenecks |
| **QA / Evaluation Analyst** | Validate that gap classifications are accurate and that resolved bottlenecks show measurable improvement |

---

## Scope

### In Scope

- Detection of bottlenecks across multi-step agentic workflows
- Classification of bottlenecks into two primary categories:
  - **Human Review Required** — steps where agent output must be reviewed/approved before proceeding
  - **Agent Capability Gap** — steps where agent fails, hallucinates, retries excessively, or produces low-confidence output
- Sub-classification of capability gaps (e.g., reasoning failure, tool misuse, missing context, instruction ambiguity, knowledge cutoff)
- Latency and frequency metrics per bottleneck type per workflow
- A prioritized bottleneck registry with severity scoring
- Integration with existing workflow orchestration logs (traces, spans)
- Dashboard and alerting for operations and product teams
- Feedback loop enabling human reviewers to label and confirm bottleneck root causes

### Out of Scope

- Automated remediation or agent self-healing (identification only)
- Model training or fine-tuning execution
- Workflow redesign tooling
- End-user-facing (customer) interfaces
- Cross-organization benchmarking or external data sharing

---

## Functional Requirements

### FR-1: Bottleneck Detection

- **FR-1.1** The system must ingest workflow execution traces (structured logs, spans, tool call records) in real time or near real time (≤ 5-minute lag).
- **FR-1.2** The system must detect the following bottleneck signals:
  - Human approval pending for > configurable threshold (default: 30 minutes)
  - Agent retry count exceeds threshold (default: 3 retries on a single step)
  - Confidence score below threshold on agent output (default: < 0.70)
  - Step latency exceeds P95 baseline by ≥ 2×
  - Agent explicitly requests escalation or clarification
  - Step error rate exceeds 10% over a rolling 1-hour window
- **FR-1.3** Detection rules must be configurable per workflow type without code deployment.

### FR-2: Bottleneck Classification

- **FR-2.1** Each detected bottleneck must be assigned a primary category: `human_review` or `agent_capability_gap`.
- **FR-2.2** Agent capability gaps must be sub-classified using a defined taxonomy:

  | Sub-class | Description |
  |---|---|
  | `reasoning_failure` | Multi-step logic errors or contradictory outputs |
  | `tool_misuse` | Incorrect tool selection, malformed parameters |
  | `missing_context` | Insufficient information in prompt or retrieval |
  | `instruction_ambiguity` | Underspecified task leading to divergent outputs |
  | `knowledge_cutoff` | Agent lacks up-to-date factual information |
  | `output_format_failure` | Structured output malformed or unparseable |
  | `hallucination` | Verifiably false claim in agent output |

- **FR-2.3** Human review bottlenecks must be sub-classified as:
  - `unnecessary_review` — reviewable by pattern; human adds no value
  - `necessary_review` — genuinely requires human judgment
  - `review_queue_overload` — capacity issue, not a capability issue

- **FR-2.4** Classification confidence must be recorded alongside each label; low-confidence classifications must be flagged for human labeling.

### FR-3: Severity Scoring

- **FR-3.1** Each bottleneck instance must receive a severity score (1–5) computed from:
  - Frequency (occurrences per 1,000 workflow runs)
  - Impact on end-to-end latency (% contribution)
  - Downstream error amplification (does the bottleneck cause cascading failures?)
  - Business criticality of the affected workflow (configurable weight per workflow)
- **FR-3.2** Severity scores must be recalculated on a rolling 24-hour basis.

### FR-4: Bottleneck Registry

- **FR-4.1** All identified bottlenecks must be stored in a queryable registry with the following fields:
  - `bottleneck_id`, `workflow_id`, `step_id`, `category`, `sub_class`, `first_seen`, `last_seen`, `occurrence_count`, `severity_score`, `status` (`open` / `in_review` / `resolved`), `assigned_owner`, `resolution_notes`
- **FR-4.2** The registry must support filtering by category, sub-class, workflow, severity, and status.
- **FR-4.3** The registry must expose a REST API and support CSV/JSON export.

### FR-5: Dashboard & Alerting

- **FR-5.1** A dashboard must display:
  - Top 10 bottlenecks by severity score (current period vs. prior period)
  - Bottleneck volume trend by category over configurable time window
  - Per-workflow bottleneck heatmap by step
  - Mean time to resolution (MTTR) per bottleneck category
- **FR-5.2** Alerts must fire when:
  - A new bottleneck reaches severity ≥ 4 within its first 24 hours
  - A previously resolved bottleneck recurs within 14 days
  - Human review queue backlog exceeds 50 pending items for > 1 hour
- **FR-5.3** Alerts must be deliverable via email, Slack webhook, and PagerDuty.

### FR-6: Human Feedback Loop

- **FR-6.1** Human reviewers must be able to confirm, override, or add detail to auto-generated classifications via a lightweight labeling interface.
- **FR-6.2** Overrides must be logged with reviewer ID, timestamp, and rationale.
- **FR-6.3** Override data must feed back into classification model retraining pipeline (handoff to ML team; execution out of scope).

### FR-7: Integrations

- **FR-7.1** The system must consume traces from at least: LangSmith, OpenTelemetry-compliant orchestrators, and a generic webhook endpoint for custom orchestration frameworks.
- **FR-7.2** The system must write resolved bottleneck records to the organization's existing task/ticket system (Jira or Linear) via configurable integration.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given a workflow trace with a step that has 4+ retries, the system detects and classifies a bottleneck within 5 minutes of trace ingestion. |
| AC-2 | Bottleneck classification achieves ≥ 85% agreement with human-labeled ground truth on a held-out evaluation set of 200 bottleneck instances. |
| AC-3 | Severity scores reflect updated occurrence data within 24 hours of new events. |
| AC-4 | The registry API returns filtered query results in < 500 ms at P95 under 50 concurrent users. |
| AC-5 | Dashboard loads fully in < 3 seconds on a standard broadband connection. |
| AC-6 | An alert for a severity-4+ bottleneck is delivered to at least one configured channel within 10 minutes of threshold being crossed. |
| AC-7 | Human override of a classification is persisted and reflected in the registry within 60 seconds of submission. |
| AC-8 | The system processes a backfill of 90 days of historical workflow traces without data loss or duplicate bottleneck records. |
| AC-9 | All bottleneck records and reviewer labels are retained for a minimum of 12 months. |
| AC-10 | Detection rules can be updated and take effect without a service restart or code deployment. |

---

## Out of Scope

- **Automated remediation:** The system identifies and reports bottlenecks; it does not automatically fix agent behavior, reroute workflows, or trigger model updates.
- **Model training execution:** Feedback data is prepared and handed off; fine-tuning pipelines are owned by the ML team and are not part of this system.
- **Workflow redesign tooling:** Recommendations may be surfaced, but a workflow editor or redesign assistant is a separate product initiative.
- **Agent capability benchmarking against external models:** Comparisons with third-party model performance are out of scope.
- **End-user / customer-facing views:** All interfaces are internal-only.
- **Real-time (< 1 minute) streaming analytics:** Near-real-time (≤ 5 minutes) is the target; sub-minute streaming is a future phase.
- **Mobile application:** Dashboard is web-only in this version.