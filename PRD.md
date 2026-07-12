> **PRD** — drafted by Ada (Sr. Product Mgr) · task #151
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Backlog & Ticket State Analyzer

## Problem & Goal

**Problem:**
Product managers and engineering leaders lack real-time, actionable insights into the health of their backlog and ongoing work. Manual inspection is time-consuming, error-prone, and reactive, leading to:
- Overlooked overdue or blocked tasks.
- Stale work-in-progress (WIP) consuming resources without progress.
- Misaligned priorities (e.g., high-priority unassigned work, low-priority tasks hoarding resources).
- Unhealthy backlogs (e.g., ungroomed or unsized tickets).
- Missed deadlines due to unaddressed velocity gaps or growing bug debt.

**Goal:**
Provide automated, prioritized insights into backlog and ticket health, surfacing the most critical issues requiring immediate attention. Enable leaders to triage effectively and proactively manage project risks.

---

## Target Users / ICP Roles

| Role                     | Pain Points Addressed                                                                 |
|--------------------------|---------------------------------------------------------------------------------------|
| **Product Managers**     | Overseeing scope, deadlines, and team capacity; need visibility into blockers and risks. |
| **Engineering Managers** | Managing team velocity, dependency resolution, and work distribution.                 |
| **Tech Leads**           | Identifying stalled work, blocked dependencies, and priority misalignments.           |
| **Scrum Masters**        | Ensuring backlog health, sprint readiness, and resolving impediments.                  |
| **Agile Coaches**        | Monitoring team health, WIP limits, and continuous improvement opportunities.         |

---

## Scope

### In Scope
1. **Automated Backlog Analysis:**
   - Scan and analyze ticketing systems (e.g., Jira, Linear, Azure DevOps) for health metrics.
   - Support for customizable thresholds (e.g., "stale" = 7+ days of inactivity).

2. **Attention List Generation:**
   - Prioritized "Top 10 Attention Items" ranked by impact on project health.
   - Each item includes evidence (e.g., days overdue, last activity date) and a direct link to the ticket.

3. **Health Metrics:**
   - Overdue items (grouped by epic).
   - Stale/Aging WIP (in-progress >7 days with no activity).
   - Blocked items (unresolved dependencies or blockers).
   - Priority misalignment (e.g., high-priority unassigned tasks, low-priority consuming resources).
   - Backlog health (ratio of groomed/ungroomed, sized/unsized).
   - Velocity gap (current vs. required to hit deadlines).
   - Bug debt (open bugs by severity, age, and trend).

4. **Output Formats:**
   - Interactive dashboard with filters (e.g., by team, epic, or priority).
   - Scheduled reports (e.g., Slack/email digests).
   - Direct links to tickets for one-click triage.

5. **Integrations:**
   - Initial support for Jira (Cloud/Server), with extensibility for other tools.

6. **Customization:**
   - Configurable thresholds (e.g., "stale" = 5+ days).
   - Adjustable ranking criteria for the "Top 10 Attention List."

7. **Scheduled Scans:**
   - On-demand scans.
   - Recurring scans (e.g., daily/weekly).

---

### Functional Requirements

| ID   | Requirement                                                                                     | Details                                                                                     |
|------|------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| FR1  | **Backlog Scan**                                                                               | Trigger manual or scheduled scans of the backlog and active tickets.                        |
| FR2  | **Overdue Items Detection**                                                                   | Identify and group past-due tasks by epic, displaying days overdue.                         |
| FR3  | **Stale/Aging WIP Detection**                                                                 | Flag tasks in-progress for >7 days (configurable) with no activity.                        |
| FR4  | **Blocked Items Detection**                                                                   | Identify tasks with unresolved dependencies or blockers (link to blocker evidence).         |
| FR5  | **Priority Misalignment Detection**                                                           | Flag high-priority unassigned tasks and low-priority tasks consuming resources.             |
| FR6  | **Backlog Health Metrics**                                                                    | Calculate and display ratios of groomed/ungroomed and sized/unsized tickets.                |
| FR7  | **Velocity Gap Analysis**                                                                     | Compare current velocity against required velocity to hit deadlines.                       |
| FR8  | **Bug Debt Analysis**                                                                         | Categorize open bugs by severity and age, and trend analysis (growing/shrinking).           |
| FR9  | **Attention List Generation**                                                                 | Generate a "Top 10 Attention Items" list ranked by impact, with direct links to tickets.     |
| FR10 | **Evidence & Context**                                                                        | Provide evidence for each attention item (e.g., last activity date, days overdue).          |
| FR11 | **Customizable Thresholds**                                                                   | Allow users to configure thresholds (e.g., "stale" = 5+ days).                              |
| FR12 | **Output & Notifications**                                                                    | Display results in a dashboard and send reports via email/Slack.                            |
| FR13 | **Integration Support**                                                                       | Integrate with Jira (Cloud/Server) for initial release.                                     |
| FR14 | **Triage Links**                                                                              | Provide one-click links to tickets for easy action.                                         |

---

## Acceptance Criteria

1. **Automated Backlog Scan:**
   - The system can scan backlogs on-demand or on a scheduled basis (e.g., daily).
   - Scans complete within 5 minutes for backlogs with <10,000 tickets.

2. **Overdue Items Detection:**
   - Past-due tasks are identified, grouped by epic, and displayed with days overdue.
   - Overdue items appear in the "Top 10 Attention List" if they rank highly by impact.

3. **Stale/Aging WIP Detection:**
   - Tasks in-progress for >7 days (default, configurable) with no activity are flagged.
   - Evidence (e.g., last activity date) is displayed alongside each stale item.

4. **Blocked Items Detection:**
   - Tasks with unresolved dependencies or blockers are identified.
   - Blocker evidence (e.g., linked tickets) is provided for each blocked item.

5. **Priority Misalignment Detection:**
   - High-priority unassigned tasks and low-priority tasks consuming resources are flagged.
   - Misaligned items appear in the "Top 10 Attention List."

6. **Backlog Health Metrics:**
   - Ratios of groomed/ungroomed and sized/unsized tickets are calculated and displayed.
   - Ungroomed/unsized tickets appear in the "Top 10 Attention List" if critical.

7. **Velocity Gap Analysis:**
   - Current velocity is compared against required velocity to hit deadlines.
   - Significant gaps are surfaced in the "Top 10 Attention List."

8. **Bug Debt Analysis:**
   - Open bugs are categorized by severity and age.
   - Growing bug trends (e.g., +10% in high-severity bugs) are surfaced in the "Top 10 Attention List."

9. **Attention List Generation:**
   - A "Top 10 Attention Items" list is generated, ranked by impact on project health.
   - Each item includes a title, evidence, and a direct link to the ticket for triage.

10. **Triage Links:**
    - Every attention item includes a one-click link to the ticket for immediate action.

11. **Customizable Thresholds:**
    - Users can configure thresholds (e.g., "stale" = 5+ days) via settings.

12. **Integration Support:**
    - Initial integration with Jira (Cloud/Server) is functional and tested.
    - Backlog scans work seamlessly with Jira's data model.

13. **Output & Notifications:**
    - Results are displayed in a dashboard with filters (e.g., team, epic).
    - Scheduled reports are sent via email/Slack, summarizing the "Top 10 Attention Items."

---

## Out of Scope

1. **Automated Ticket Resolution:**
   - The system will not auto-resolve or auto-assign tickets. It surfaces issues for manual triage.

2. **Non-Backlog Data:**
   - Analysis of non-ticket data (e.g., Git repos, CI/CD pipelines) is out of scope for v1.

3. **Multi-Tool Aggregation:**
   - Simultaneous analysis across multiple ticketing tools (e.g., Jira + Linear) is not supported in v1.

4. **AI/ML Predictions:**
   - Predictive analysis (e.g., "this epic will miss its deadline") is out of scope.

5. **User Management:**
   - Role-based access control (RBAC) for the analyzer is not included in v1.

6. **Real-Time Alerts:**
   - Real-time alerts (e.g., Slack mentions for new blockers) are out of scope.

7. **Historical Trend Analysis:**
   - Deep historical trend analysis (e.g., "velocity over last 6 months") is not included in v1.