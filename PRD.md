# PRD: Resource Gap Analysis with Hiring & Deployment Recommendations — Draft (v0) — Task #244

---

## Signature

> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #244
> _Each agent that updates this PRD signs its change below._

---

## Problem & Goal

Engineering and operations leaders lack a structured, data-driven view of where workforce capability gaps exist across teams, skills, and time horizons. Decisions about hiring, redeployment, and contractor engagement are made reactively, inconsistently, and without clear prioritization frameworks.

**Goal:** Deliver an automated resource gap analysis system that ingests current headcount, skills inventory, project demand forecasts, and capacity data to produce actionable hiring and deployment recommendations — enabling leaders to make proactive, evidence-based workforce decisions.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| VP Engineering / CTO | Portfolio-level visibility into capability gaps; budget justification |
| Engineering Managers | Team-level gap view; redeployment options for existing staff |
| HR / Talent Acquisition | Prioritized hiring queue with role specifications |
| Program / Project Managers | Demand-side inputs; staffing risk flags on active projects |
| Finance Business Partners | Headcount cost modeling; hire vs. contract tradeoff analysis |

---

## Scope

### In Scope

- Ingestion and normalization of current headcount and skills data (from HRIS, skills matrices, or CSV upload)
- Ingestion of project demand forecasts (capacity requirements by skill, role, and time period)
- Gap computation engine: supply vs. demand delta by skill cluster, role, team, and quarter
- Hiring recommendation generation: role title, seniority, required skills, urgency tier, estimated time-to-fill
- Deployment recommendation generation: internal redeployment candidates ranked by skill match and availability
- Build vs. buy vs. borrow analysis (hire FTE / redeploy / contract / upskill tradeoffs)
- Dashboard: gap heatmap, coverage scores, recommendation queue
- Export: PDF executive summary, CSV recommendation data

### Out of Scope (see section below)

---

## Functional Requirements

### FR-1: Data Ingestion & Normalization

- **FR-1.1** Accept structured employee data including: employee ID, current role, team, skills (with proficiency level 1–5), location, and availability percentage.
- **FR-1.2** Accept project demand data including: project ID, required skills, required seniority, FTE demand, and demand timeline (start/end quarter).
- **FR-1.3** Support CSV upload and REST API integration with common HRIS platforms (Workday, BambooHR).
- **FR-1.4** Normalize skill taxonomy using a configurable canonical skill dictionary; flag unmapped skills for admin review.

### FR-2: Gap Computation Engine

- **FR-2.1** Compute supply-demand delta per skill per quarter: `Gap = Forecasted Demand (FTE) − Available Supply (FTE)`.
- **FR-2.2** Apply proficiency weighting: a level-3 skill match against a level-5 requirement counts as partial supply (configurable weighting table).
- **FR-2.3** Segment gaps by: skill cluster, seniority band, team/org unit, and geographic location.
- **FR-2.4** Classify each gap by severity: Critical (>50% uncovered demand), Moderate (25–50%), Low (<25%).
- **FR-2.5** Surface compounding gaps where the same skill deficit appears across three or more concurrent projects.

### FR-3: Hiring Recommendations

- **FR-3.1** Generate a ranked hiring backlog where each item includes: role title, required skills (with minimum proficiency), seniority band, target team, demand start date, urgency tier (P1/P2/P3), and estimated cost range.
- **FR-3.2** Urgency tier calculated from: gap severity, demand start date, and estimated time-to-fill (configurable per role family).
- **FR-3.3** Flag roles where external contractor engagement is more cost-effective than FTE hire given demand duration < configurable threshold (default: 6 months).
- **FR-3.4** Allow Talent Acquisition to mark recommendations as "In Progress," "Approved," or "Deferred," with status synced back to gap dashboard.

### FR-4: Deployment Recommendations

- **FR-4.1** For each identified gap, query existing workforce for employees with matching or adjacent skills, sufficient proficiency, and available capacity.
- **FR-4.2** Rank redeployment candidates by: skill match score, proficiency delta vs. requirement, current utilization rate, and transition lead time.
- **FR-4.3** Generate a redeployment card per candidate showing: current assignment, projected end date, skill match rationale, and manager contact.
- **FR-4.4** Flag redeployments that would create a secondary gap in the source team and surface that risk explicitly.

### FR-5: Upskill Pathway Recommendations

- **FR-5.1** For gaps where a near-match employee exists (proficiency delta ≤ 1 level), recommend an upskill pathway.
- **FR-5.2** Upskill recommendations include estimated ramp time, suggested learning resource category (internal training, external certification, mentorship), and projected readiness date.

### FR-6: Dashboard & Reporting

- **FR-6.1** Gap heatmap: skills × time (quarters) grid with color-coded severity.
- **FR-6.2** Coverage score per project: percentage of demanded skill-FTEs covered by confirmed supply.
- **FR-6.3** Recommendation queue view filterable by: urgency tier, org unit, skill cluster, recommendation type (hire/deploy/upskill/contract).
- **FR-6.4** Trend view: gap delta week-over-week as recommendations are actioned.
- **FR-6.5** Executive summary report (PDF): top 5 critical gaps, top 10 hiring recommendations, deployment opportunities, and cost impact estimate.
- **FR-6.6** Raw data export to CSV for all recommendations and gap data.

### FR-7: Access Control & Audit

- **FR-7.1** Role-based access: Executives (read-only, all orgs), Managers (read/write, own org), HR/TA (read/write, all hiring data), Admins (full configuration).
- **FR-7.2** All recommendation status changes logged with timestamp and user ID.
- **FR-7.3** Employee-level skill data accessible only to roles with explicit HR data permission.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | A CSV upload of 500 employees and 50 projects produces a complete gap analysis within 60 seconds. |
| AC-2 | Gap severity classifications match manual spot-check calculations for a 20-row test dataset with zero errors. |
| AC-3 | Hiring recommendations are generated for every Critical and Moderate gap; no P1 gap exists without at least one recommendation. |
| AC-4 | Redeployment candidates are returned for ≥80% of gaps where a skill match exists within the employee dataset (verified against test fixture). |
| AC-5 | Secondary gap risk flag fires correctly in 100% of test cases where a redeployment would reduce source team coverage below 75%. |
| AC-6 | Role-based access controls verified: a Manager-role test user cannot view employee skill data outside their org unit. |
| AC-7 | PDF executive summary renders correctly and contains all six required sections for any date range input. |
| AC-8 | Recommendation status updates (Approve/Defer/In Progress) reflect on the gap dashboard within 5 seconds without page reload. |
| AC-9 | Skill taxonomy normalization flags 100% of unmapped skills in a test upload containing 10 intentionally unmapped entries. |
| AC-10 | System handles concurrent sessions from 50 users without degradation in gap computation response time (< 60s threshold maintained). |

---

## Out of Scope

- **Payroll or compensation management** — cost estimates are indicative ranges only; no integration with payroll systems.
- **Performance management data** — employee performance ratings are not ingested or factored into recommendations.
- **Automated job posting or ATS integration** — hiring recommendations are outputs to humans; no direct push to Greenhouse, Lever, or similar.
- **Learning Management System (LMS) integration** — upskill pathways reference resource categories, not specific LMS course enrollments.
- **Real-time calendar or utilization tracking** — availability data is manually entered or batch-imported; no live calendar API sync.
- **Contractor / vendor management portal** — the system recommends contractor engagement but does not manage procurement workflows.
- **Mobile-native application** — responsive web only in v1; native iOS/Android apps deferred.
- **Multi-language / localization support** — English only in v1.
- **Predictive attrition modeling** — supply projections assume current headcount remains stable; attrition risk forecasting is a future capability.