> **PRD** — drafted by Ada (Sr. Product Mgr) · task #220
> _Each agent that updates this PRD signs its change below._

# PRD: Pipeline Blocker Detection — Human Decision & Approval Bottlenecks

## Problem & Goal

Engineering and operations teams lose significant cycle time when tasks stall waiting for human decisions, sign-offs, or approvals that are never explicitly surfaced as blockers. These stalls are invisible in standard pipeline views, making it impossible to proactively route, escalate, or eliminate them. The goal is to automatically detect, classify, and surface tasks that are blocked specifically because a human decision or approval has not been rendered, so that the right people can act before the delay compounds.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager / Team Lead | Spot blocked PRs, design reviews, and deployment approvals in their team's queue |
| Program / Project Manager | Identify cross-team approval gaps that are holding up milestones |
| DevOps / Release Engineer | Detect environment, change-management, or CAB approvals blocking deploys |
| Product Manager | Find spec or roadmap decisions that are blocking sprint work |
| Executive Sponsor | Get a roll-up view of high-priority pipeline stalls requiring leadership decisions |

---

## Scope

### In Scope

- Ingestion of task/work-item data from connected project-management and CI/CD tools (Jira, Linear, GitHub Issues, Asana, Azure DevOps, and GitHub Actions pipelines as first-class integrations)
- Detection of tasks in a "waiting-for-human" state using status labels, PR review states, comment signals, and time-since-last-activity heuristics
- Classification of blocker type (approval, review, decision, sign-off, escalation)
- Identification of the responsible human actor(s) who must act
- Calculation of block duration and estimated downstream impact (dependent tasks at risk)
- Surfacing blockers in a unified dashboard with filtering by team, project, severity, and blocker type
- Alerting and notification routing to the blocking party and their manager after a configurable SLA threshold
- Exportable blocker report (CSV, JSON, PDF)

---

## Functional Requirements

### FR-1 — Data Ingestion & Normalization
- The system MUST poll or receive webhook events from connected tools at a configurable interval (default: 5 minutes).
- The system MUST normalize task states, assignees, reviewers, and timestamps into a canonical schema regardless of source tool.
- The system MUST support OAuth 2.0 and token-based authentication for each integration.

### FR-2 — Blocker Detection Engine
- The system MUST flag a task as "human-blocked" when **any** of the following signals are present:
  - Task status matches a configurable set of "waiting" labels (e.g., `awaiting-approval`, `blocked`, `pending-review`, `needs-decision`).
  - A PR has been in `review_requested` state for longer than the team's configured SLA without a review action.
  - A task comment contains explicit blocker language detected by the NLP classifier (e.g., "waiting on", "need sign-off from", "blocked by [person]").
  - A task has had no status change or assignee activity for a configurable idle period (default: 48 hours) while in an active sprint or pipeline stage.
- The system MUST assign a confidence score (0–100) to each detected blocker.
- The system MUST allow administrators to define custom detection rules using a rule-builder UI.

### FR-3 — Blocker Classification
- The system MUST categorize each detected blocker into one of the following types:
  - **Approval** — formal sign-off required (e.g., CAB, legal, finance)
  - **Code/Design Review** — technical or design peer review pending
  - **Decision** — open question requiring a choice before work can proceed
  - **Escalation** — issue requires a higher authority to resolve
  - **External Dependency** — awaiting a third-party human actor outside the organization
- The system MUST surface the most likely blocking actor(s) derived from `@mentions`, review request metadata, or team ownership mappings.

### FR-4 — Impact Assessment
- The system MUST calculate and display:
  - **Block duration**: time elapsed since the task entered the blocked state.
  - **Dependent task count**: number of downstream tasks that cannot start or complete until this blocker is resolved.
  - **At-risk milestone(s)**: sprint, release, or project milestone whose deadline is jeopardized based on dependency chain analysis.
  - **Estimated delay impact**: projected slip in days/hours derived from the dependency graph and remaining capacity.

### FR-5 — Unified Blocker Dashboard
- The system MUST provide a dashboard with:
  - A sortable, filterable table of all active human-blocked tasks.
  - Filters: team, project, blocker type, assigned reviewer/approver, severity, source tool, date range.
  - A summary panel showing total blockers, average block duration, and at-risk milestones.
  - A dependency graph visualization showing the blast radius of each blocker.
- The dashboard MUST refresh in near-real-time (≤ 60-second lag from source event).

### FR-6 — Alerting & Escalation
- The system MUST send a notification to the identified blocking actor when a task has been blocked beyond the team-configured SLA (default: 24 hours).
- The system MUST send an escalation notification to the blocking actor's manager when the block persists beyond a secondary SLA (default: 72 hours).
- Notification channels MUST include: email, Slack, Microsoft Teams, and in-app.
- Notification content MUST include: task name, block duration, dependent task count, a direct link to the task, and a one-click "I'm on it" acknowledgement action.

### FR-7 — Reporting & Export
- The system MUST generate a Blocker Report on a configurable schedule (daily, weekly, ad hoc).
- Reports MUST be exportable in CSV, JSON, and PDF formats.
- Reports MUST include: blocker list, block durations, responsible actors, resolution status, and trend data over the selected period.

### FR-8 — Administration & Configuration
- Admins MUST be able to configure: SLA thresholds per team, custom blocker-status labels per tool, escalation chains, and NLP detection sensitivity.
- The system MUST support role-based access control (RBAC) with at minimum: Admin, Manager, and Viewer roles.
- All configuration changes MUST be logged in an immutable audit trail.

---

## Acceptance Criteria

| ID | Criterion | Verification Method |
|---|---|---|
| AC-1 | A task enters "awaiting-approval" status in Jira and appears in the blocker dashboard within 5 minutes. | End-to-end integration test |
| AC-2 | A PR with a pending review request for 25 hours (SLA = 24 h) triggers a Slack notification to the assigned reviewer. | Automated notification test with mock clock |
| AC-3 | Blocker classification correctly labels ≥ 85% of seeded test cases across all five blocker types. | NLP model evaluation on labeled test set (n ≥ 500) |
| AC-4 | The impact assessment correctly identifies all first-order dependent tasks for a given blocker. | Unit test against known dependency graph fixture |
| AC-5 | Dashboard filters return correct results with ≤ 2-second response time under a load of 200 concurrent users. | Performance test with k6 or Locust |
| AC-6 | Escalation notification is sent to the manager after 72 hours of unresolved block; no duplicate notification is sent if already escalated. | Integration test with time-warp fixture |
| AC-7 | CSV export of the blocker report contains all required fields and is UTF-8 encoded with no data truncation. | Automated export validation test |
| AC-8 | An admin can add a custom detection rule and a newly created task matching that rule is flagged as blocked within one polling cycle. | Manual QA + automated regression test |
| AC-9 | A Viewer role user cannot modify SLA thresholds or notification settings; UI controls are disabled and API returns 403. | RBAC permission test |
| AC-10 | All detection and classification activity is logged in the audit trail with actor, timestamp, and change delta. | Audit log inspection post-test-run |

---

## Out of Scope

- **Automated resolution of blockers** — the system surfaces and routes blockers but does not take automated action to approve, reject, or reassign on behalf of humans.
- **Non-human blockers** — infrastructure outages, flaky CI tests, external service dependencies, or resource contention are not in scope for this release.
- **Financial or legal workflow engines** — deep integration with DocuSign, Coupa, or ERP approval chains is a future phase.
- **Predictive SLA violation forecasting** — ML-based prediction of which tasks *will* become blocked is deferred to a subsequent release.
- **Mobile native app** — web-responsive UI is sufficient for v1; dedicated iOS/Android apps are out of scope.
- **Bi-directional write-back to source tools** — the system reads from and notifies through integrated tools but does not modify task status, assignees, or comments in source systems in v1.
- **Historical blocker data migration** — only tasks active at or after integration setup date are in scope; retroactive analysis of pre-integration history is not.