> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #209
> _Each agent that updates this PRD signs its change below._

# PRD: Project Task Counter & Effort Estimator

## Problem & Goal
**Problem:**
Teams lack real-time visibility into the volume of open tasks per project and the aggregate effort required to complete them. Manual tracking via spreadsheets or ad-hoc queries is error-prone, time-consuming, and inconsistent across projects. This opacity leads to misaligned priorities, resource bottlenecks, and missed deadlines.

**Goal:**
Automate the counting of open tasks per project and calculate the remaining effort (in story points or T-shirt sizes) to provide teams with:
1. A consolidated view of pending work.
2. Effort-based prioritization insights.
3. Data-driven resource allocation decisions.

---

## Target Users / ICP Roles
**Primary:**
- **Engineering Managers:** Track team capacity and project health.
- **Product Managers:** Align backlog with business goals and timelines.
- **Scrum Masters/Agile Coaches:** Monitor sprint progress and adjust scopes.
- **Tech Leads:** Identify risks (e.g., high-effort, unassigned tasks).

**Secondary:**
- **Executives:** High-level progress reporting (e.g., portfolio-level dashboards).
- **Team Members:** Self-serve visibility into their workload.

---

## Scope
### In Scope:
1. **Task Counting:**
   - Aggregate open tasks (e.g., "To Do," "In Progress") per project or board.
   - Filter by task attributes (e.g., assignee, label, priority, due date).
2. **Effort Estimation:**
   - Support story points (numeric) and T-shirt sizes (S/M/L/XL) as effort units.
   - Calculate total remaining effort per project/board.
   - Allow manual overrides for unestimated tasks (e.g., default to median effort).
3. **Visualization & Reporting:**
   - Generate summary tables (e.g., projects vs. open tasks/effort).
   - Export data (CSV, JSON) or embed into existing dashboards (e.g., Grafana, Power BI).
4. **Alerts & Notifications:**
   - Threshold-based alerts (e.g., "Project X has >100 story points open").
   - Weekly digest emails for subscribed users.
5. **Integration:**
   - Read-only API access to task managers (e.g., Jira, Linear, GitHub Issues, Trello).
   - Webhook support for real-time updates.

### Out of Scope:
1. **Task Creation/Modification:** No write access to task managers.
2. **Resource Scheduling:** No automated assignment or capacity planning.
3. **Historical Trend Analysis:** Initial release focuses on current state (no time-series data).
4. **AI/ML Predictions:** No effort estimation via machine learning (manual entry only).
5. **Multi-tool Aggregation:** No cross-project aggregation (e.g., Jira + Linear) in v1.

---

## Functional Requirements
| ID   | Requirement                                                                                     | Priority |
|------|-------------------------------------------------------------------------------------------------|----------|
| FR-1 | Fetch open tasks from supported integrations (Jira, GitHub Issues, etc.).                      | P0       |
| FR-2 | Count open tasks per project/board, with filters (e.g., label, assignee, date).                | P0       |
| FR-3 | Calculate total remaining effort (story points or T-shirt sizes) per project/board.            | P0       |
| FR-4 | Support manual effort overrides for unestimated tasks.                                          | P1       |
| FR-5 | Generate summary tables for open tasks/effort (sortable, paginated).                            | P0       |
| FR-6 | Export data in CSV/JSON formats.                                                                | P1       |
| FR-7 | Trigger alerts/notifications when effort exceeds configured thresholds.                        | P2       |
| FR-8 | Provide a REST API for querying counts/effort.                                                  | P1       |
| FR-9 | Refresh data on a configurable schedule (e.g., hourly) or via webhooks.                        | P1       |
| FR-10| Support T-shirt size mappings to story points (e.g., S=1, M=3, L=5).                            | P1       |
| FR-11| Display effort distribution (e.g., bar chart of tasks by size).                                 | P2       |

---

## Acceptance Criteria
### General:
1. **Accuracy:**
   - Counts and effort totals match the source of truth (e.g., Jira API) for open tasks.
   - Effort calculations handle edge cases (e.g., tasks with no estimation, deleted tasks).
2. **Performance:**
   - Data refresh completes within 5 minutes for projects with ≤10k tasks.
   - API responses return within 2 seconds (paginated for large datasets).
3. **Usability:**
   - Summary tables are sortable by task count, effort, or project name.
   - Error messages are actionable (e.g., "Failed to fetch tasks: Check API key permissions").
4. **Security:**
   - No sensitive data (e.g., API keys) is logged or exposed in exports.

### Integration-Specific:
| Integration  | Criteria                                                                                     |
|--------------|----------------------------------------------------------------------------------------------|
| **Jira**     | - Supports Jira Cloud and Server (via REST API). <br> - Handles custom fields for effort.    |
| **GitHub**   | - Works with GitHub Issues and Projects. <br> - Maps labels to T-shirt sizes (e.g., `size:L`).|
| **Linear**   | - Supports Linear’s GraphQL API. <br> - Uses Linear’s estimate field.                        |

### Alerts:
- Thresholds are configurable per project (e.g., "Alert when effort > 100 story points").
- Alerts include a link to the filtered task list for investigation.

### Export:
- CSV/JSON exports include project name, task count, effort total, and timestamp.

---

## Out of Scope (Detailed)
1. **Effort Estimation Beyond Supported Units:**
   - No support for Fibonacci sequences, ideal days, or other estimation techniques.
2. **Task Dependencies:**
   - Ignores blocking/blocked relationships between tasks.
3. **Multi-Team Aggregation:**
   - Cannot combine data from multiple teams/orgs (e.g., cross-tenant aggregation).
4. **Cost Tracking:**
   - No connection to budget or financial data (e.g., "effort → cost").
5. **Mobile App:**
   - No dedicated mobile interface (responsive web only).
6. **On-Premise Deployment:**
   - Cloud-hosted only (no self-hosted option initially).