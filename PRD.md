> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #251
> _Each agent that updates this PRD signs its change below._

# PRD: One-Page Health Card per Project

## Problem & Goal

Project stakeholders currently lack a single, at-a-glance view of a project's health. Status information is scattered across task trackers, dashboards, and status updates, forcing managers and team members to aggregate data manually before they can assess whether a project is on track. The goal is to generate a concise, one-page health card for each project that surfaces the most critical signals — schedule, budget, risks, team, and quality — in a standardized, scannable format.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Project Manager** | Quickly communicate project status to stakeholders; identify issues early |
| **Executive / Portfolio Owner** | Review health across multiple projects without deep-diving into details |
| **Team Lead / Tech Lead** | Validate that engineering signals (build health, blockers) are accurately represented |
| **Client / External Stakeholder** | Receive a clean, professional summary without access to internal tooling |

---

## Scope

The health card covers **one project at a time** and is intended to be generated on demand or on a recurring schedule (weekly by default). It aggregates data from connected sources and renders a single structured view — printable, shareable as PDF, and viewable in-app.

---

## Functional Requirements

### 1. Project Identity Header
- Display project name, unique ID, owner name, and project phase (Planning / In Progress / On Hold / Closed).
- Show the reporting period (e.g., "Week of 2025-07-14") and the date the card was generated.

### 2. Overall Health Indicator
- Render a single RAG (Red / Amber / Green) status badge for the project overall.
- Display a one-to-two sentence plain-language health summary written or approved by the project manager.
- Show a trend indicator (↑ improving / → stable / ↓ degrading) relative to the previous reporting period.

### 3. Key Metrics Panel
Render the following metrics in a compact grid, each with its current value, target value, and RAG status:

| Metric | Source |
|---|---|
| Schedule Variance (days ahead/behind) | Task tracker milestone data |
| Budget Utilization (% of approved budget spent) | Finance / cost tracking integration |
| Scope Change Count (approved changes this period) | Change log |
| Open Blockers / Critical Issues | Issue tracker |
| Test Pass Rate / Build Health | CI/CD or QA tool |

### 4. Milestone Tracker
- List the next three upcoming milestones with due date, owner, and status (Not Started / In Progress / At Risk / Complete).
- Highlight any milestone past its due date in red.

### 5. Risk & Issue Summary
- Display up to five top-priority risks, each with: risk title, likelihood (H/M/L), impact (H/M/L), and mitigation owner.
- Display up to five open critical/high issues with title, age (days open), and assignee.
- Link each item to its source record in the connected tool.

### 6. Team Pulse
- Show current headcount versus planned headcount.
- Flag any open critical resource gaps (roles unfilled for more than 14 days).
- Display team capacity utilization as a percentage.

### 7. Decisions & Actions Needed
- List up to five items requiring stakeholder decision or escalation, each with owner and due date.
- Items older than their due date are automatically flagged.

### 8. Export & Sharing
- Export the health card as a single-page PDF (A4 / Letter) preserving all visual formatting.
- Generate a shareable read-only link valid for 7 days (configurable).
- Support embedding the card in a Confluence page or Notion doc via iframe or link-unfurl.

### 9. Generation & Scheduling
- Allow manual on-demand generation at any time.
- Support automated generation on a configurable cadence (daily, weekly, bi-weekly).
- Notify the project manager via in-app notification and email when a new card is generated.

### 10. Data Freshness
- Display a "last synced" timestamp for each data source.
- Warn visually if any data source has not synced within the past 24 hours.

---

## Acceptance Criteria

1. **AC-1 — Completeness:** A generated health card contains all nine sections (Identity Header, Overall Health, Metrics Panel, Milestone Tracker, Risk & Issue Summary, Team Pulse, Decisions Needed, Export, Data Freshness indicators) with no empty/missing sections when data is available in connected sources.

2. **AC-2 — RAG Accuracy:** The overall RAG status matches the logic defined in the RAG rule configuration; a project with ≥1 overdue milestone AND budget utilization >105% must render Red with no exceptions.

3. **AC-3 — Single Page Constraint:** The exported PDF renders on exactly one A4/Letter page at 100% zoom without truncation of any section content; overflow content uses abbreviated display with a "view full detail" deep-link.

4. **AC-4 — Data Freshness Warning:** If any connected data source has not synced in more than 24 hours, a yellow banner appears in both the in-app view and the PDF export.

5. **AC-5 — Sharing Link:** A generated shareable link correctly renders the read-only health card to an unauthenticated user and expires after the configured validity period (default 7 days).

6. **AC-6 — Scheduling:** An automated health card is generated within ±15 minutes of the configured schedule time and the project manager receives the notification within 5 minutes of generation.

7. **AC-7 — Performance:** The health card fully loads in-app within 3 seconds for a project with up to 500 tasks, 50 risks, and 10 connected integrations on a standard connection.

8. **AC-8 — Access Control:** A user without at least Viewer-level permission on a project cannot access that project's health card via direct URL or shareable link once the link has expired.

---

## Out of Scope

- **Portfolio / program roll-up view** — aggregating health across multiple projects into a single dashboard is a separate feature.
- **Historical health card archive UI** — storing and browsing past health cards beyond the current period is not included in v1 (raw data is retained for future use).
- **AI-generated narrative analysis** — auto-written insights or recommendations beyond the plain-language summary are deferred to a future iteration.
- **Native mobile app rendering** — the health card is optimized for desktop web and PDF; mobile-responsive layout is a fast-follow.
- **Custom section creation** — project managers cannot add, remove, or reorder sections in v1; layout is fixed.
- **Real-time live updates** — the card reflects the state at generation time and does not auto-refresh in-app.
- **Direct editing of source data** — the health card is read-only; all edits must be made in the originating tool.
- **Billing or invoicing data** — financial metrics are limited to budget utilization; invoice and payment status are out of scope.