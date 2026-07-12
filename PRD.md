> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #284
> _Each agent that updates this PRD signs its change below._

# PRD: Project Status Dashboard Indicator

## Problem & Goal

Teams and stakeholders lack a single, instantly readable signal for overall project health. Without a standardized status indicator, status updates are buried in meeting notes, Slack threads, or lengthy reports — leading to delayed escalations and misaligned expectations. The goal is to surface a clear, real-time **Green / Yellow / Red** project status that any stakeholder can interpret at a glance.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Executive Sponsor** | Instant health check without reading full reports |
| **Project Manager** | Canonical place to set and justify status |
| **Team Lead** | Awareness of cross-team blockers affecting status |
| **Stakeholder / Client** | Confidence that issues are visible and owned |

---

## Scope

This PRD covers the definition, calculation, display, and update workflow for a single **Project Status Indicator** (PSI) surfaced on a project dashboard or status page.

---

## Functional Requirements

### FR-1 — Status States
The system MUST support exactly three status values:

| Status | Meaning |
|---|---|
| 🟢 **Green** | On track — no critical blockers; timeline and budget within acceptable thresholds |
| 🟡 **Yellow** | At risk — one or more concerns require attention; mitigation plan exists or in progress |
| 🔴 **Red** | Blocked / off track — critical blocker, missed milestone, or budget/scope breach requiring escalation |

### FR-2 — Status Ownership
- A designated **Project Manager** (or delegate) MUST be able to manually set the current status.
- Status changes MUST require a brief mandatory justification note (≤ 280 characters).

### FR-3 — Status Display
- The current status, last-updated timestamp, owner name, and justification note MUST be visible on the project's primary dashboard view.
- Status MUST render accessibly (color + label text + icon — not color alone).

### FR-4 — Status History
- All status changes MUST be logged with: previous state → new state, timestamp, author, and justification note.
- History MUST be viewable in reverse-chronological order.

### FR-5 — Notifications
- A status change to **Yellow** MUST notify the project team channel/email list.
- A status change to **Red** MUST notify the project team **and** executive sponsor(s).
- Notifications MUST include the justification note and a direct link to the project dashboard.

### FR-6 — Staleness Warning
- If the status has not been updated in **7 calendar days**, the UI MUST display a staleness warning prompting the PM to confirm or update the status.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | PM can set status to Green, Yellow, or Red from the dashboard in ≤ 3 clicks |
| AC-2 | Status change without a justification note is rejected with an inline validation error |
| AC-3 | Dashboard displays status label, icon, owner, timestamp, and note without requiring scroll on a 1280 px viewport |
| AC-4 | Status change to Red triggers email/channel notification to team + sponsors within 60 seconds |
| AC-5 | Full status history is accessible and shows all required fields for every past change |
| AC-6 | Staleness warning appears on day 8 if no update has been made |
| AC-7 | Status indicator passes WCAG 2.1 AA color-contrast and non-color-only requirements |

---

## Out of Scope

- **Automated status calculation** from ticket velocity, CI pipelines, or budget tools (manual update only for v1)
- **Per-workstream or sub-task status** — this covers project-level status only
- **External public-facing status pages** (customer-facing communication is a separate surface)
- **SLA enforcement or escalation workflows** beyond the notification requirement
- **Mobile-native app** — web responsive is sufficient for v1
- **Integration with specific third-party PM tools** (Jira, Asana, Monday) — API hooks deferred to v2