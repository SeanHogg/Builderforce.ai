> **PRD** — drafted by Ada (Sr. Product Mgr) · task #216
> _Each agent that updates this PRD signs its change below._

# PRD: Current Utilization Rate per Agent (Busy vs Idle)

## Problem & Goal

Support operations and workforce managers lack real-time visibility into how individual agents are spending their time. Without a per-agent utilization metric that clearly distinguishes busy time from idle time, managers cannot identify bottlenecks, redistribute workloads, detect underperforming agents, or make informed staffing decisions. The goal is to deliver a live, continuously updated utilization dashboard and supporting data layer that surfaces the busy/idle ratio for every active agent.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Support / Contact Center Manager** | Monitor team utilization in real time; spot overloaded or idle agents instantly |
| **Workforce Management (WFM) Analyst** | Pull historical utilization data for capacity planning and scheduling optimization |
| **Operations Lead / Team Lead** | Drill into individual agent status to coach or reassign work mid-shift |
| **Executive / Director of CX** | Aggregate utilization KPIs for SLA compliance and headcount justification |

---

## Scope

### In Scope
- Real-time per-agent utilization rate calculation (busy % and idle %)
- Definition and tracking of **Busy** states: handling a conversation, in after-call work (ACW/wrap-up), on hold
- Definition and tracking of **Idle** states: available/waiting, away, offline, on break (configurable)
- Live dashboard view with per-agent rows and sortable columns
- Historical utilization data stored and queryable (minimum 90-day retention)
- Aggregated utilization view at team, queue, and org level
- Configurable state-to-status mappings (which agent statuses count as busy vs idle)
- Export of utilization data (CSV, PDF)
- Alerting when an agent's idle time exceeds a configurable threshold

### Out of Scope
- Payroll, HR performance reviews, or disciplinary workflows
- Quality assurance (QA) scoring or conversation sentiment analysis
- Predictive staffing recommendations or AI scheduling
- Native mobile application (web-responsive only for v1)
- Integration with third-party WFM platforms (planned for v2)

---

## Functional Requirements

### FR-1: Agent State Tracking
- The system must capture a timestamped state-change event every time an agent transitions between any defined status (e.g., Available → Handling → Wrap-Up → Available).
- State change latency from event to data availability must be ≤ 5 seconds.
- The system must support a minimum of 10 distinct configurable agent statuses.

### FR-2: Utilization Rate Calculation
- **Utilization Rate** = `(Total Busy Time / Total Logged-In Time) × 100`, expressed as a percentage.
- Calculations must be available at the following time windows: current shift, last 1 hour, last 8 hours, today, last 7 days, custom range.
- Idle time = `Total Logged-In Time − Total Busy Time`.
- The system must exclude offline/logged-out time from the denominator.

### FR-3: Real-Time Dashboard
- Display a live table with one row per active agent showing: Agent Name, Current Status, Current Status Duration, Utilization Rate (shift), Busy Time (shift), Idle Time (shift), Last State Change.
- Dashboard must refresh automatically without requiring a manual page reload (push or polling ≤ 10-second interval).
- Managers must be able to filter by team, queue, status, and date range.
- Rows must be sortable by any column.
- Color-coded status indicators: green (busy/handling), amber (wrap-up/away), red (idle > threshold).

### FR-4: Historical Reporting
- Provide a reporting view that returns per-agent utilization statistics for any custom date/time range within the 90-day retention window.
- Support grouping by agent, team, and queue.
- Allow export of query results as CSV and PDF.

### FR-5: Configurable State Mapping
- Administrators must be able to designate each agent status as **Busy**, **Idle**, or **Excluded** (e.g., scheduled break, training).
- Changes to state mappings must apply to all future calculations without retroactively altering historical records.

### FR-6: Threshold Alerts
- Administrators must be able to configure an idle-duration alert threshold per team or globally (e.g., alert after 15 minutes of continuous idle).
- Alerts must be delivered via in-app notification and optionally via email or webhook.
- Alert events must be logged with agent ID, threshold breached, start time, and duration.

### FR-7: Role-Based Access Control
- Managers and Team Leads may view utilization data only for agents within their assigned teams.
- WFM Analysts may view utilization data org-wide in read-only mode.
- Executives/Directors may view aggregate org-level summaries.
- Only Administrators may modify state mappings and alert thresholds.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given an agent changes status, the dashboard reflects the new status and updates utilization within 10 seconds. |
| AC-2 | Given an agent has been logged in for 60 minutes and spent 45 minutes in Busy states, the system displays a utilization rate of 75.0%. |
| AC-3 | Given a manager filters the dashboard by a specific team, only agents belonging to that team are shown. |
| AC-4 | Given an agent has been idle for longer than the configured threshold, an in-app alert fires and is logged within 30 seconds of the threshold being crossed. |
| AC-5 | Given an administrator remaps a status from Idle to Busy, subsequent utilization calculations use the new mapping and historical data remains unchanged. |
| AC-6 | Given a WFM Analyst exports a 30-day utilization report for all agents, a correctly formatted CSV file is generated within 60 seconds. |
| AC-7 | Given a Team Lead logs in, they can view only the agents in their assigned team(s) and cannot access other teams' data. |
| AC-8 | Given the system is under load with 500 concurrent active agents, the dashboard continues to refresh within the 10-second SLA with no data loss. |
| AC-9 | Utilization data is retained and queryable for a minimum of 90 calendar days. |
| AC-10 | Offline / logged-out time is never included in the utilization rate denominator. |

---

## Out of Scope

- Payroll processing, HR records, or formal performance management workflows
- Conversation quality scoring, CSAT, or NPS metrics
- AI-driven forecasting, staffing recommendations, or automated scheduling
- Native iOS / Android mobile applications
- Integration or data sync with third-party WFM tools (e.g., Verint, NICE, Assembled) — targeted for v2
- Screen recording or agent desktop activity monitoring
- Retroactive recalculation of historical utilization when state mappings are changed