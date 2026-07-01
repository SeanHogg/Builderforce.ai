> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #197
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD): Cloud Agent 50-Gap Validation Status Tracker

## **Problem & Goal**
**Problem:**
Today, the Cloud Agent team lacks real-time visibility into the validation status of the 50 identified security/compliance gaps (classified as P0/P1/P2). Without a centralized tracker, engineering, security, and leadership teams cannot:
- Accurately measure progress toward SOC2/HIPAA readiness.
- Prioritize blocking gaps for upcoming audits.
- Report status transparently to stakeholders.

**Goal:**
Build a lightweight, automated system to track and visualize the validation status of all 50 gaps, surfacing:
- How many P0/P1/P2 gaps remain open.
- Trends over time (e.g., “20 open gaps reduced to 5 in the last 30 days”).
- Ownership and next action for each gap.

---

## **Target Users / ICP Roles**
| Role                     | Use Case                                                                 |
|--------------------------|--------------------------------------------------------------------------|
| **Product Security Lead** | Track blocking gaps vs. audit deadlines; prove SOC2/HIPAA readiness.    |
| **Engineering Managers** | Identify team capacity needs; prioritize sprint work on open gaps.      |
| **QA Engineers**         | Verify fixes; update validation status post-testing.                    |
| **CPO/CTO**              | Monitor progress toward compliance milestones; allocate resources.      |

---

## **Scope**
**In Scope:**
- **Data:**
  - Ingest gap metadata (ID, title, severity, owner, Jira ticket, validation evidence URL).
  - Capture validation timestamps, tester name, and status (`Open → In Progress → Validated`).
- **UI:**
  - Simple dashboard showing:
    - Countdown (`3/50 P0 gaps open → 47 validated`).
    - Severity breakdown (P0/P1/P2 grid).
    - Time trend chart (last 90 days).
    - Click-through to gap details/Jira ticket.
- **Automation:**
  - Daily sync from Jira → tracker (no manual CSV uploads).
  - Slack/Wiki digest summarizing delta changes (e.g., “P1 gap CA-223 validated yesterday”).
- **Ops:**
  - Self-service permissions for team leads to edit metadata/ownership.

**Out of Scope:**
- Root-cause deep dives or bug reproduction steps outside Jira.
- Integrations beyond Jira (e.g., GitHub PRs, AWS Config).
- Custom reporting for external auditors (export dumps acceptable).

---

## **Functional Requirements**
| ID   | Requirement                                                                 | Owner           |
|------|-----------------------------------------------------------------------------|-----------------|
| FR1  | Ingest gap list from CSV/Jira with severity labels (`P0`/`P1`/`P2`).        | Infra           |
| FR2  | Display real-time count & status for each severity level.                   | Frontend        |
| FR3  | Allow status transitions (`Open → In Progress → Validated`) via dropdown.  | Frontend        |
| FR4  | Show trend chart (gaps closed/opened per week) for any 30/60/90-day view.   | Frontend        |
| FR5  | Link each gap row to its Jira ticket and validation evidence.               | Frontend        |
| FR6  | Generate weekly Slack digest of delta changes (net new gaps closed).        | Backend         |
| FR7  | Enforce permissions so only leads can mutate severity/ownership.            | Backend         |
| FR8  | Sync Jira ticket status daily → normalize to tracker state.                 | Backend         |

---

## **Acceptance Criteria**
**MVP:**
- [ ] Dashboard renders total open/validated counts by severity.
- [ ] All 50 gaps displayed as rows with Jira links; 80% have status populated.
- [ ] Daily Slack digest sent to `#cloud-compliance` with yesterday’s delta.
- [ ] Data freshness ≤ 24 hours latency.

**Polish:**
- [ ] Trend chart shows moving average over rolling 90 days.
- [ ] Email digest option for managers off-Slack.
- [ ] Time-to-close metric calculated for each gap closed in last 30 days.

---

## **Out of Scope**
- Root-cause debugging workflows.
- Automated playbooks for remediation.
- Auditor-specific compliance reporting (PDF/export only).
- Integration with ticketing beyond Jira.