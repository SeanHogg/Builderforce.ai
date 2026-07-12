> **PRD** — drafted by Ada (Sr. Product Mgr) · task #239
> _Each agent that updates this PRD signs its change below._

# PRD: Resource Gap Analysis Feature

## Problem & Goal

Engineering leads, project managers, and operations teams lack a consolidated view of the delta between their current resource inventory and what is actually required to deliver planned work. Decisions are made on intuition or stale spreadsheets, leading to understaffing, budget overruns, delayed projects, and undetected bottlenecks.

**Goal:** Build a Resource Gap Analysis feature that automatically computes the difference between available resources (people, skills, capacity, budget, tools) and the resources needed to fulfill planned work — and surfaces prioritized, actionable recommendations to close each identified gap.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Engineering Manager / Team Lead** | Identify skill and headcount gaps before sprint or project kickoff |
| **PMO / Program Manager** | Portfolio-level view of resource shortfalls across multiple projects |
| **HR / Talent Partner** | Translate gap data into hiring plans and timelines |
| **Finance / Budget Owner** | Understand cost implications of resource gaps and mitigation options |
| **Executive Sponsor** | Summary view of risk exposure due to resource constraints |

---

## Scope

### In Scope

- Ingestion of current resource data (people, roles, skills, availability, FTE allocation, budget)
- Ingestion of demand data (project plans, workstreams, required skills, timelines, estimated effort)
- Gap computation engine (current vs. needed, per resource dimension)
- Severity classification of each gap (Critical / High / Medium / Low)
- Recommendation generation per gap
- Dashboard and tabular views
- Export capability (CSV, PDF)
- Alerts and notifications when gaps exceed defined thresholds
- Integration connectors for common HRIS, project management, and capacity planning tools

### Out of Scope

- Automated procurement or hiring execution (recommendations only)
- Real-time payroll or compensation management
- Performance management or employee reviews
- Resource scheduling or shift management beyond capacity modeling

---

## Functional Requirements

### FR-1: Resource Inventory Management

1. The system shall allow users to define and maintain a current resource registry including: personnel (name, role, seniority, skills, availability percentage, cost rate) and non-human resources (tools, licenses, budget pools).
2. The system shall support manual entry and bulk import (CSV/XLSX) of resource data.
3. The system shall integrate with at least two HRIS or workforce management systems (e.g., Workday, BambooHR) via API to sync resource records.
4. Availability calculations shall account for planned leave, part-time allocations, and existing project commitments.

### FR-2: Demand Input & Project Requirements

1. The system shall allow users to define resource demand per project or workstream, specifying: required roles, required skills, effort in hours or FTE-weeks, and start/end dates.
2. The system shall integrate with at least two project management tools (e.g., Jira, Asana, Monday.com) to import task and milestone data.
3. Users shall be able to set demand at portfolio, program, or individual project level.

### FR-3: Gap Computation Engine

1. The system shall compute the gap for each resource dimension as:
   `Gap = Needed Resources − Available Resources`
2. Gap computation shall be performed across the following dimensions:
   - **Headcount** (number of people per role)
   - **Skills** (specific competencies mapped to taxonomy)
   - **Capacity / Availability** (FTE-hours per period)
   - **Budget** (cost of needed vs. available resources)
3. Gaps shall be computed at configurable time horizons: current sprint, monthly, quarterly, annual.
4. Negative gaps (surplus) shall be identified and flagged separately from deficits.
5. Gap calculations shall refresh automatically when source data changes and on a configurable scheduled basis (minimum: daily).

### FR-4: Severity Classification

1. Each gap shall be automatically classified using a four-tier severity model:
   - **Critical:** Blocks project delivery within the current period
   - **High:** Causes schedule slip > 2 weeks or budget variance > 15%
   - **Medium:** Causes minor delay or requires reallocation
   - **Low:** Addressable with existing resources through minor adjustment
2. Users shall be able to override severity classification with a documented rationale.
3. Severity thresholds shall be configurable per organization.

### FR-5: Recommendation Engine

1. For each identified gap, the system shall generate at minimum one recommendation from the following categories:
   - **Hire:** Role definition, suggested seniority, estimated time-to-fill, cost impact
   - **Upskill / Reskill:** Identify internal candidates and suggest training paths
   - **Reallocate:** Surface underutilized resources with matching or adjacent skills
   - **Defer / Descope:** Flag work that could be deprioritized to resolve capacity conflicts
   - **Contract / Augment:** Estimate cost and timeline for contractor or vendor engagement
2. Recommendations shall display estimated effort to implement, cost delta, and time-to-resolution.
3. Users shall be able to mark a recommendation as accepted, rejected, or in-progress and record a mitigation owner.
4. Accepted recommendations shall automatically reduce the computed gap in a simulated "what-if" view.

### FR-6: Dashboard & Reporting

1. The system shall provide an executive summary dashboard showing:
   - Total open gaps by severity
   - Gaps by department, role family, and skill domain
   - Trend lines of gap evolution over the last 90 days
   - Top 5 at-risk projects by resource constraint
2. The system shall provide a detailed gap table with filterable columns: resource type, gap dimension, severity, project, time horizon, recommendation status.
3. Users shall be able to generate and export reports in PDF and CSV formats.
4. All dashboard views shall support date-range filtering and role-based data segmentation.

### FR-7: Alerts & Notifications

1. The system shall send configurable alerts (email and in-app) when:
   - A new Critical or High gap is detected
   - A gap's severity escalates
   - A recommended mitigation passes its due date without resolution
2. Alert recipients and thresholds shall be configurable per team or project.

### FR-8: Access Control

1. The system shall enforce role-based access control (RBAC) with at minimum three roles: Viewer, Contributor, and Admin.
2. Sensitive data (cost rates, compensation-linked fields) shall be restricted to Finance and Admin roles.
3. All data access shall be logged for audit purposes.

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | Gap computation produces correct deficit and surplus values for all five resource dimensions against a defined test dataset with ≤ 0.1% variance | Automated unit and integration tests |
| AC-2 | Severity classification matches expected output for 100% of predefined scenario test cases | QA regression suite |
| AC-3 | At least one recommendation is generated for every gap flagged as Medium or above | Automated test on gap dataset |
| AC-4 | Dashboard loads portfolio-level view with up to 500 projects in < 3 seconds (P95) | Load test |
| AC-5 | HRIS and PM tool integrations sync data within 15 minutes of source change | Integration test with sandbox environments |
| AC-6 | Exported PDF and CSV reports contain all visible dashboard data and match on-screen values | Manual QA verification |
| AC-7 | RBAC prevents Viewer-role users from accessing cost-rate fields; verified via penetration test scenario | Security test |
| AC-8 | Alerts are delivered within 5 minutes of threshold breach during load test | End-to-end automated test |
| AC-9 | What-if simulation correctly reduces gap totals when recommendations are marked accepted | Functional test with documented scenarios |
| AC-10 | All user-facing actions are captured in the audit log with timestamp, user ID, and action type | Audit log inspection |

---

## Out of Scope

- Automated execution of hiring workflows, job posting, or ATS integration
- Real-time capacity adjustments triggered by live timesheets
- Individual employee performance tracking or evaluation
- Compensation benchmarking or salary band management
- Shift scheduling, on-call management, or workforce rostering
- Financial forecasting beyond direct resource cost modeling
- Mobile native application (web responsive only in v1)
- AI-generated job descriptions or training content (recommendation pointers only)