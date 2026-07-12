> **PRD** — drafted by Ada (Sr. Product Mgr) · task #148
> _Each agent that updates this PRD signs its change below._

# PRD: Diagnostic Questionnaire Engine — Structured Onboarding Interview

## Problem & Goal

### Problem
When a PM or project leader onboards a new project into the platform, there is no structured mechanism to capture the project's current health state. Without a baseline, the system cannot surface meaningful risks, prioritize alerts, or provide relevant recommendations. Onboarding today is either manual, inconsistent, or skipped entirely.

### Goal
Deliver a Diagnostic Questionnaire Engine that guides PMs through a structured, adaptive interview at onboarding time, producing a persisted **project health baseline** that all downstream features (risk engine, dashboards, alert routing) can consume.

---

## Target Users / ICP Roles

| Role | Context | Primary Need |
|---|---|---|
| **PM / Project Lead** | Onboarding a net-new or inherited project | Quickly establish a documented health baseline |
| **Engineering Leader** | Onboarding a portfolio of projects | Bulk-import baselines without answering Q-by-Q |
| **Program Manager** | Overseeing cross-functional delivery | Capture stakeholder priorities and deadline dependencies |
| **Platform Admin** | Configuring the tool for their org | Customize question sets per project type or template |

---

## Scope

### In Scope
- Step-by-step onboarding wizard with conditional question logic
- Eight core diagnostic question domains (detailed below)
- Two input modes: **Guided** (interactive wizard) and **Bulk** (structured file import)
- Persistence of responses as a versioned project health baseline record
- Basic validation and completeness scoring on submission
- Integration status detection (auto-pre-fill where possible from connected tools)

### Out of Scope
- AI-generated answers or automated baseline inference (future phase)
- Ongoing re-assessment scheduling or baseline drift detection (future phase)
- Custom question builder UI for admins (future phase)
- Multi-language / localization support (future phase)
- Public API for third-party baseline ingestion beyond the defined import format (future phase)

---

## Functional Requirements

### FR-1 — Onboarding Wizard (Guided Mode)

**FR-1.1** The wizard SHALL present questions one section at a time in a defined canonical order, with a visible progress indicator (e.g., Step 3 of 7).

**FR-1.2** Each section SHALL have a title, a short explanatory description, and one or more input fields appropriate to the answer type (radio, multi-select, date picker, currency, free text, ranked list).

**FR-1.3** The wizard SHALL support **back navigation** without losing previously entered answers.

**FR-1.4** The wizard SHALL allow users to **save progress and resume later**; an incomplete baseline is stored as `status: draft`.

**FR-1.5** On final submission the wizard SHALL display a **baseline summary screen** showing all captured values before the user confirms.

---

### FR-2 — Diagnostic Question Domains

The following eight domains are required in V1. Each domain maps to one or more wizard steps.

#### Domain 1 — Project Status
- Current health status: `Green / Yellow / Red` (required, single-select)
- Free-text rationale for the selected status (optional, ≤ 500 chars)

#### Domain 2 — Deadlines
- Business deadline(s): date + label (e.g., "Board review", repeatable)
- Customer / contractual deadline(s): date + label + associated customer name (repeatable)
- Conditional: if any deadline is within 30 days, prompt for "What is at risk if this deadline slips?"

#### Domain 3 — Overdue Deliverables
- Binary: are there currently overdue deliverables? (`Yes / No`)
- Conditional on `Yes`:
  - Number of overdue items
  - Average days overdue
  - Most critical overdue item (free text + severity: `Low / Medium / High / Critical`)

#### Domain 4 — Budget
- Total approved budget (currency + amount)
- Actual spend to date (currency + amount)
- Conditional: if actual spend > 90 % of budget, prompt "What is your mitigation plan?" (free text)
- Projected spend at completion (optional)

#### Domain 5 — Connected Integrations
- Multi-select checklist: `GitHub / Jira / Slack / CI-CD pipeline / PagerDuty / Other`
- System SHALL auto-detect already-connected integrations and pre-check them (read-only where confirmed)
- For each selected integration, capture connection status: `Active / Pending / Broken`

#### Domain 6 — Ingested Data
- Multi-select checklist of data types ingested: `Commits / Pull Requests / Incidents / Deployments / Test results / On-call rotations / Other`
- For each checked type, capture approximate data freshness: `< 24 h / 1–7 days / > 7 days / Unknown`
- System SHALL auto-populate from integration metadata where available

#### Domain 7 — Top Risks
- Capture exactly **3 risks** (required); user may add up to 5 total
- Per risk: title (required), description (optional), likelihood (`Low / Medium / High`), impact (`Low / Medium / High`), owner (free text or user lookup)
- Computed risk score (likelihood × impact) displayed inline as read-only feedback

#### Domain 8 — Key Stakeholders & Priorities
- Add stakeholders (repeatable): name, role/title, organization/team
- Per stakeholder: primary priority (free text, ≤ 200 chars), preferred communication channel (`Email / Slack / Meetings / Other`)
- Flag stakeholders as `Informed / Consulted / Accountable / Responsible` (RACI-lite, multi-select)

---

### FR-3 — Conditional Logic

**FR-3.1** The engine SHALL evaluate answer-driven conditions after each field change and show/hide dependent fields or steps in real time without full-page reload.

**FR-3.2** Conditional rules SHALL be declarative and stored in configuration (not hard-coded in UI), enabling future admin customization.

**FR-3.3** Skipped conditional steps SHALL NOT be marked as incomplete; the baseline record SHALL store `null` for unanswered conditional fields with a `skipped_reason` tag.

---

### FR-4 — Bulk / Import Mode

**FR-4.1** Users SHALL be able to download a **template file** (JSON and CSV formats both supported) pre-populated with field keys and accepted value enumerations.

**FR-4.2** Users SHALL be able to upload a completed template; the system SHALL validate the file against the schema and return a structured error report for any invalid rows or missing required fields.

**FR-4.3** A valid import SHALL create or overwrite the project health baseline with `source: bulk_import` and the uploader's identity recorded.

**FR-4.4** After a successful import, users SHALL be presented with the same **baseline summary screen** as guided mode and given the option to edit individual fields in the wizard before confirming.

---

### FR-5 — Baseline Persistence & Versioning

**FR-5.1** Each submitted baseline SHALL be stored as a versioned record: `v1, v2, …` keyed to project ID and submission timestamp.

**FR-5.2** The latest submitted version SHALL be the **active baseline**; prior versions SHALL be accessible in a read-only audit trail.

**FR-5.3** Baseline records SHALL expose a structured JSON schema consumable by downstream services (risk engine, dashboard, alerting).

**FR-5.4** Baseline status lifecycle: `draft → submitted → superseded`.

---

### FR-6 — Completeness Score

**FR-6.1** The system SHALL compute a **baseline completeness score** (0–100 %) based on the ratio of answered required fields to total required fields.

**FR-6.2** The score SHALL be displayed on the summary screen and stored in the baseline record.

**FR-6.3** Projects with a completeness score below 60 % SHALL display a persistent in-app prompt to complete the baseline.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | A PM can launch the onboarding wizard from the project dashboard and complete all 8 domains without error. |
| AC-02 | Conditional questions for overdue deliverables (Domain 3) appear only when the user selects `Yes` and are hidden (not skipped as errors) when `No` is selected. |
| AC-03 | Conditional budget mitigation prompt (Domain 4) appears only when actual spend ≥ 90 % of approved budget. |
| AC-04 | Deadline proximity condition (Domain 2) triggers the risk-of-slip prompt for any deadline ≤ 30 days from today. |
| AC-05 | Auto-detection pre-fills Domain 5 (integrations) and Domain 6 (ingested data) based on confirmed connected integrations; pre-filled values are visible and user-editable. |
| AC-06 | Wizard progress is saved on each section submission; resuming an in-progress wizard restores all previously entered values. |
| AC-07 | The baseline summary screen accurately reflects all answers before final confirmation. |
| AC-08 | A submitted baseline is retrievable via the internal baseline API with correct schema within 2 seconds of confirmation. |
| AC-09 | A valid bulk import file creates a complete baseline record; an invalid file returns field-level error messages without creating a partial record. |
| AC-10 | Re-submitting the wizard creates a new baseline version (`v2`, etc.) and marks the previous version as `superseded`. |
| AC-11 | Baseline completeness score is displayed on the summary screen and stored; a score < 60 % triggers the in-app completion prompt on the project dashboard. |
| AC-12 | All wizard interactions are accessible via keyboard navigation and meet WCAG 2.1 AA contrast requirements. |

---

## Out of Scope

- **AI / ML auto-inference of baseline values** from historical data — the engine captures human-declared state only in V1.
- **Scheduled re-assessment** — periodic re-runs of the questionnaire are not triggered automatically.
- **Admin question builder UI** — customizing the question set via a GUI is deferred; changes require config updates.
- **Multi-project batch wizard** — guided mode operates on one project at a time; bulk import covers the multi-project use case.
- **External / public API** for baseline ingestion outside the defined import format.
- **Localization** — English only in V1.
- **Mobile-native experience** — responsive web is required; dedicated iOS/Android app views are out of scope.
- **Approval workflows** — baseline submissions do not require a second approver in V1.