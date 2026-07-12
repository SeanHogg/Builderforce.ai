> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #282
> _Each agent that updates this PRD signs its change below._

# PRD: Team Health Dashboard — Capacity, Burnout & Skill Gap Visibility

## Problem & Goal

Engineering and people managers lack a unified, real-time view of their team's operational health. Capacity is tracked in spreadsheets, burnout signals are invisible until attrition occurs, and skill gaps are discovered reactively during project staffing. This results in missed commitments, surprise resignations, and costly last-minute hiring or contractor engagement.

**Goal:** Deliver a Team Health product surface that gives managers and HR business partners continuous, actionable visibility into team capacity, early burnout indicators, and skill coverage — enabling proactive intervention before problems escalate.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager (EM) | Understand who is over/under-allocated; catch burnout early |
| Director / VP Engineering | Cross-team capacity roll-up; identify systemic skill gaps |
| HR Business Partner (HRBP) | Monitor wellbeing signals; feed into retention programs |
| Team Lead / Tech Lead | Peer-level visibility into skill coverage for sprint planning |
| Individual Contributor (IC) | Self-service view of own load and declared skill profile |

---

## Scope

### In Scope (v1)

- **Capacity tracking:** per-person allocation percentages across active projects/workstreams, updated at least weekly
- **Burnout risk scoring:** composite signal from overtime hours, after-hours activity, PTO utilization rate, and optional pulse survey responses
- **Skill inventory:** self-declared and manager-validated skill tags per person, mapped to a canonical skill taxonomy
- **Skill gap analysis:** delta between skills required by current/upcoming projects and skills available on the team
- **Alerts & notifications:** proactive nudges to managers when thresholds are breached
- **Dashboard views:** individual, team, and cross-team (director+) rollup
- **Integrations:** calendar/time-tracking (Google Calendar, Jira, Toggl), HRIS (Workday, BambooHR), survey tool (Culture Amp, Lattice)

### Out of Scope (v1)

See [Out of Scope](#out-of-scope) section below.

---

## Functional Requirements

### FR-1: Capacity Management

1. **FR-1.1** The system shall ingest allocation data from connected project-tracking tools (Jira, Linear, Asana) and display each person's total allocated percentage in real time (refresh ≤ 24 hours).
2. **FR-1.2** Managers shall be able to manually set or override allocation percentages when tooling data is incomplete.
3. **FR-1.3** The system shall surface over-allocation warnings (>100% capacity) and under-allocation flags (<50% for ≥5 business days).
4. **FR-1.4** A team-level capacity heatmap shall show available bandwidth per sprint/week for the next 8 weeks, factoring in approved PTO.
5. **FR-1.5** The system shall support custom capacity profiles (e.g., 80% FTE for part-time employees, parental-leave hold).

### FR-2: Burnout Risk Detection

1. **FR-2.1** The system shall compute a **Burnout Risk Score (BRS)** (Low / Moderate / High / Critical) per person using a weighted composite of:
   - Overtime hours (>10% above contracted hours in a rolling 2-week window)
   - After-hours commits/messages (outside declared working hours)
   - PTO utilization vs. accrual rate (flag if <25% of annual PTO used by mid-year)
   - Meeting load (>60% of working hours in meetings)
   - Optional: pulse survey sentiment score
2. **FR-2.2** BRS shall be recalculated at least weekly and on-demand.
3. **FR-2.3** Managers shall receive an in-app and email alert when any direct report reaches **High** or above.
4. **FR-2.4** All burnout data shall be accessible only to the individual, their direct manager, and HR. Cross-team directors see aggregate/anonymized data only unless HR grants exception.
5. **FR-2.5** Individuals shall be able to opt out of behavioral signal collection (overtime hours, after-hours activity) while retaining PTO-based and survey-based scoring.

### FR-3: Skill Inventory

1. **FR-3.1** Each team member shall maintain a skill profile consisting of skills selected from a canonical taxonomy (e.g., SFIA or a custom org taxonomy).
2. **FR-3.2** Skills shall carry a self-assessed proficiency level (1–4: Awareness / Working / Practitioner / Expert).
3. **FR-3.3** Managers shall be able to validate, adjust (with justification), or flag skills for review.
4. **FR-3.4** Skills shall be tagged as **current** or **developing** (actively being learned).
5. **FR-3.5** Skill profiles shall integrate with the HRIS as the system of record and sync bidirectionally.

### FR-4: Skill Gap Analysis

1. **FR-4.1** Project owners shall be able to define a **required skill set** (skill + minimum proficiency) for a project or workstream.
2. **FR-4.2** The system shall automatically compute coverage: % of required skills met by available team members at the required proficiency.
3. **FR-4.3** Uncovered skills shall surface as **Gap Items** with severity (Critical / Moderate / Low) based on project timeline and skill uniqueness.
4. **FR-4.4** For each Gap Item the system shall suggest: internal candidates who are "developing" in that skill, adjacent skills that partially satisfy the need, and a prompt to initiate a hire/contract request.
5. **FR-4.5** Managers at director level and above shall see a cross-team skill gap matrix.

### FR-5: Alerts & Notifications

1. **FR-5.1** Notification channels: in-app, email, and Slack/Teams integration.
2. **FR-5.2** Managers shall be able to configure alert thresholds and notification frequency per metric.
3. **FR-5.3** All alerts shall link directly to the relevant dashboard view and suggested action.
4. **FR-5.4** The system shall not send burnout-related alerts to channels visible to the affected individual's peers.

### FR-6: Access Control & Privacy

1. **FR-6.1** Role-based access control (RBAC) with roles: IC, Team Lead, Manager, Director+, HR, Admin.
2. **FR-6.2** ICs see only their own data. Managers see direct reports. Directors see aggregated rollup. HR sees all with audit log.
3. **FR-6.3** All personal health-signal data shall be encrypted at rest and in transit.
4. **FR-6.4** A full audit log of who viewed individual burnout records shall be maintained and accessible to HR and Admin.

---

## Acceptance Criteria

| ID | Criterion | Verification Method |
|---|---|---|
| AC-01 | Capacity data refreshes within 24 hours of a change in the connected source tool | Automated integration test |
| AC-02 | Over-allocation (>100%) alerts are delivered to the manager within 1 hour of the threshold being breached | End-to-end alert test |
| AC-03 | Burnout Risk Score recalculates fully within 1 hour of the weekly scheduled run | Performance test on dataset of 500 users |
| AC-04 | An IC who opts out of behavioral signals still receives a BRS derived from PTO and survey data alone, with no gap in UI | Manual QA + opt-out flow test |
| AC-05 | A skill gap analysis run on a 10-project, 50-person team completes in <10 seconds | Load test |
| AC-06 | A director-level user cannot see individual BRS scores for people outside their org without explicit HR override | RBAC penetration test |
| AC-07 | Burnout alert Slack message is not visible in any shared channel; it is delivered as a DM to the manager only | Manual QA |
| AC-08 | Skill profile changes sync to HRIS within 4 hours of validation | Integration test |
| AC-09 | 8-week capacity heatmap correctly incorporates approved PTO imported from the HRIS | UAT with HRBP sign-off |
| AC-10 | All pages meet WCAG 2.1 AA accessibility standards | Automated accessibility scan + manual screen-reader test |

---

## Out of Scope

- **Performance management or PIP workflows** — this product surfaces health signals; it does not support formal performance processes.
- **Compensation benchmarking or pay equity analysis.**
- **Automated hiring requisition creation** — the system prompts for a hire request but does not create reqs in ATS.
- **Learning Management System (LMS) course delivery** — skill gap suggestions link out to existing LMS; no content is hosted here.
- **Peer feedback or 360 review collection** — managed in existing tools (Lattice, Culture Amp).
- **Real-time (sub-hourly) data pipelines** in v1 — a 24-hour refresh cadence is acceptable for capacity; near-real-time is a v2 consideration.
- **Mobile native app** — responsive web only in v1.
- **Support for contractors or vendor staff** in skill inventory in v1 — FTEs only.
- **AI-generated coaching recommendations** beyond rule-based suggestions — flagged as a v2 feature.