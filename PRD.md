> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #281
> _Each agent that updates this PRD signs its change below._

# PRD: Risk & Blockers Visibility System

## Problem & Goal

Engineering and product teams lack a unified, real-time view of risks and blockers threatening delivery timelines. Critical issues are surfaced too late — buried in standups, Slack threads, or stale spreadsheets — causing preventable slippage. The goal is to provide a structured, proactive system that surfaces, tracks, and escalates risks and blockers before they impact commitments.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager | Identify blocked engineers and at-risk workstreams early |
| Product Manager | Understand delivery risk against roadmap commitments |
| Tech Lead / Staff Engineer | Flag and resolve technical blockers across teams |
| Program Manager | Aggregate cross-team risk for executive reporting |
| Individual Contributor (IC) | Quickly log a blocker and request help without process overhead |

---

## Scope

This PRD covers the **Risk & Blockers module** within an existing project/delivery management context. It encompasses:

- Blocker and risk capture (structured input)
- Risk classification and severity scoring
- Assignment, ownership, and escalation workflows
- Status tracking through resolution
- Reporting and trend analysis views

---

## Functional Requirements

### FR-1: Risk & Blocker Capture
- Any team member can log a risk or blocker in ≤ 60 seconds via a lightweight form.
- Required fields: `Title`, `Type` (Risk / Blocker), `Severity` (P0–P3), `Impacted workstream(s)`, `Owner`.
- Optional fields: `Due date impact`, `Mitigation plan`, `External dependency flag`, `Linked ticket/epic`.
- Support capture from web UI, Slack slash command (`/blocker`), and API.

### FR-2: Risk Classification & Scoring
- Auto-classify risks by category: Technical, Resourcing, Dependency, Scope, Timeline, External.
- Calculate a **Slip Risk Score** (0–100) based on: severity × proximity to milestone × ownership gap.
- Surface AI-generated suggested mitigations for common risk patterns (optional, configurable).

### FR-3: Assignment & Ownership
- Every risk/blocker must have exactly one named owner at all times.
- System enforces ownership: unowned items escalate automatically after a configurable SLA window.
- Owners receive daily digest and real-time push notification on status changes.

### FR-4: Escalation Workflows
- Define escalation chains per team or project (e.g., IC → TL → EM → Director).
- Auto-escalate if a blocker remains unresolved beyond SLA thresholds:
  - P0: 4 hours
  - P1: 24 hours
  - P2: 72 hours
  - P3: 7 days
- Escalation audit trail is immutable and visible to all stakeholders.

### FR-5: Status Lifecycle
- States: `Open → In Progress → Mitigated → Resolved → Closed` / `Accepted (Risk only)`.
- Require a resolution note before closing any P0 or P1 item.
- Reopening a closed item creates a linked child record, preserving history.

### FR-6: Risk Dashboard & Views
- **Team view**: All active risks/blockers for a team, sorted by Slip Risk Score.
- **Milestone view**: Risks mapped to upcoming milestones with projected impact on delivery date.
- **Dependency graph**: Visual map of external and cross-team blockers.
- **Trend view**: Weekly snapshot of open/resolved counts, average time-to-resolve, repeat risk categories.

### FR-7: Integrations
- Bidirectional sync with Jira, Linear, and GitHub Issues (link, status passthrough).
- Post escalations and daily summaries to Slack channels and Microsoft Teams.
- Export to CSV and structured JSON via API.
- Webhook support for triggering external workflows on status changes.

### FR-8: Access & Permissions
- Role-based access: Viewer, Contributor, Owner, Admin.
- All risk data scoped to project/team; cross-team visibility requires explicit grant.
- Audit log of all create, edit, escalate, and close events.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A user can log a P0 blocker in under 60 seconds from web UI and receive confirmation. |
| AC-2 | A P0 blocker with no owner update for 4 hours triggers an escalation notification to the defined escalation chain. |
| AC-3 | The Slip Risk Score updates within 5 minutes of any field change on a linked record. |
| AC-4 | The milestone view accurately reflects all open risks linked to a milestone, including those added in the last 24 hours. |
| AC-5 | Closing a P0 or P1 item without a resolution note is blocked at the UI and API layer. |
| AC-6 | A Jira issue linked to a blocker reflects status changes bidirectionally within 10 minutes. |
| AC-7 | The dependency graph renders all cross-team blockers with correct directionality for projects with ≤ 500 nodes in under 3 seconds. |
| AC-8 | An IC using Slack `/blocker` can create a valid blocker record without visiting the web UI. |
| AC-9 | Escalation audit trail entries cannot be edited or deleted by any role, including Admin. |
| AC-10 | Trend view data is accurate to within a 1-hour refresh window and is exportable to CSV. |

---

## Out of Scope

- **Root cause analysis (RCA) tooling** — post-mortems and blameless retrospectives are a separate module.
- **Capacity planning or resource allocation** — this system flags resourcing risk but does not solve staffing.
- **Sprint planning or backlog management** — integrates with planning tools but does not replace them.
- **Financial risk quantification** — no cost-impact modeling in this version.
- **Customer-facing status pages** — internal delivery risk only; external communication handled elsewhere.
- **AI auto-resolution of blockers** — suggestions surfaced, but no automated action taken on behalf of users.
- **Mobile native app** — mobile web is supported; native iOS/Android deferred to a future release.