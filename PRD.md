> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #286
> _Each agent that updates this PRD signs its change below._

# PRD: Overdue Deliverables Detection & Reporting

## Problem & Goal

Teams and project managers lack a fast, reliable way to identify which deliverables are past their due dates and by how much time. Manual tracking across spreadsheets, project tools, or tickets is error-prone and slow. The goal is to provide an automated, accurate answer to the question: **"Are there overdue deliverables, and by how much?"**

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| Project Manager | Identify at-risk or overdue items across one or more projects |
| Team Lead | Understand individual or team-level overdue workload |
| Executive / Stakeholder | High-level visibility into delivery health |
| Individual Contributor | Know which of their own deliverables are past due |

---

## Scope

This effort covers:
- Querying a data source (database, project management API, spreadsheet, or file) that contains deliverables with due dates and completion status
- Computing overdue status by comparing due dates against today's date
- Calculating the magnitude of lateness (days, weeks, or hours overdue)
- Returning a structured, human-readable report

---

## Functional Requirements

### FR-1: Data Ingestion
- The system must accept deliverable records containing at minimum:
  - `deliverable_id` or `name`
  - `due_date` (date or datetime)
  - `status` (e.g., open, in-progress, complete, cancelled)
  - `owner` (optional but surfaced if present)
- Supported data sources must include at least one of: CSV/spreadsheet file, JSON payload, SQL query result, or project management API response (e.g., Jira, Asana, Linear, GitHub Issues)

### FR-2: Overdue Detection
- A deliverable is **overdue** if:
  - `due_date` is strictly before today's date (UTC), **and**
  - `status` is not `complete` or `cancelled`
- The system must correctly handle timezone normalization when due dates include time components

### FR-3: Overdue Magnitude Calculation
- For each overdue deliverable, compute:
  - **Days overdue** = `today − due_date` (integer, rounded down)
  - **Human-readable lag** (e.g., "3 days", "2 weeks 1 day", "6 hours")
- Flag severity tiers:
  - 🟡 **Mild**: 1–7 days overdue
  - 🟠 **Moderate**: 8–30 days overdue
  - 🔴 **Critical**: 31+ days overdue

### FR-4: Reporting Output
- Produce a summary report containing:
  - Total count of deliverables evaluated
  - Count and percentage that are overdue
  - Per-deliverable detail: name, due date, days overdue, severity, owner (if available)
  - Sorted by days overdue descending (most overdue first)
- Output formats: plain-text table, markdown table, and/or JSON

### FR-5: No-Overdue Case
- If no deliverables are overdue, the system must explicitly confirm: **"No overdue deliverables found."**

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a dataset with known overdue and on-time items, the system correctly identifies only the overdue ones |
| AC-2 | Days-overdue values are accurate to within ±0 days when compared to manual calculation using today's UTC date |
| AC-3 | Completed and cancelled deliverables are never flagged as overdue |
| AC-4 | Severity tiers (Mild / Moderate / Critical) are applied correctly per FR-3 thresholds |
| AC-5 | Output report lists overdue items sorted most-overdue first |
| AC-6 | When zero deliverables are overdue, the explicit no-overdue confirmation message is returned |
| AC-7 | The system handles missing or null `due_date` values gracefully (skip with warning, do not crash) |
| AC-8 | Report generation completes in under 5 seconds for datasets up to 10,000 deliverable records |

---

## Out of Scope

- **Forecasting** future at-risk deliverables (not yet overdue)
- **Root-cause analysis** of why a deliverable is late
- **Push notifications or alerting** (e.g., email, Slack) — reporting only
- **Write-back** to source systems (status updates, due-date changes)
- **Resource or capacity planning**
- **Custom severity thresholds** (configuration of tier boundaries is a future enhancement)
- **Historical trend analysis** (e.g., how overdue delivery rate changed over time)