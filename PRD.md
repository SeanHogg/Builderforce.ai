> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #200
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD): Task Aging Analysis

## **Problem & Goal**
**Problem:**
Product, engineering, and leadership teams lack visibility into how long open tasks remain in different workflow states (e.g., Backlog, Ready, In Progress). This opacity hinders prioritization efficiency, leads to stale or orphaned work, and obscures bottlenecks in delivery pipelines.

**Goal:**
Build an automated, self-service task-aging dashboard that surfaces:
- Age distribution (e.g., <7d, 7–14d, 15–30d, 30d+) of open tasks by workflow state.
- Trend analysis (e.g., % of tasks aging beyond SLO thresholds over time).
- Actionable insights (e.g., tasks exceeding team-specific aging policies).

## **Target Users / ICP Roles**
| Role | Use Case |
|---|---|
| **Engineering Managers** | Identify long-running tasks, unblock stalled work, and coach teams on prioritization. |
| **Product Managers** | Audit backlog health, remove deprecated tasks, and reprioritize based on aging signals. |
| **DevOps/Platform Teams** | Monitor CI/CD pipeline efficiency (e.g., tasks stuck "In Progress"). |
| **Leadership/Executives** | Track organizational health metrics (e.g., Mean Time to Complete tasks). |

---

## **Scope**
### **In Scope**
1. **Data Pipeline**
   - Extract task metadata from project management tools (e.g., Jira, Linear) via API.
   - Compute aging based on `created_at`, `updated_at`, and state transitions.
   - Store raw and aggregated data in a query-optimized database (e.g., BigQuery, Snowflake).

2. **Core Features**
   - **Dashboard:** Filters for project/team, workflow state, aging buckets, assignee, and labels.
   - **Alerts:** Slack/email notifications for tasks exceeding configurable aging thresholds (e.g., "tasks stuck in Backlog >30d").
   - **Export:** CSV/JSON downloads of aging data for offline analysis.

3. **Analytics**
   - Mean/Median age by state and project.
   - Burndown charts showing aging trends (e.g., "tasks aging beyond 14d declined 20% MoM").
   - Benchmarking against team-specific SLOs (e.g., "90% of tasks in Backlog <7d").

4. **Integrations**
   - Native support for Jira, Linear, GitHub Issues.
   - SDK for custom tooling (e.g., internal project trackers).

### **Out of Scope**
- **Root cause analysis:** No built-in RCA tools (e.g., linking aging to PR reviews or dependencies).
- **Automated cleanup:** No functionality to auto-archive/close stale tasks.
- **Cross-tool deduplication:** No merging of tasks tracked in multiple tools.
- **Forecasting:** No predictive models (e.g., "this task will likely age 5d longer based on history").
- **Custom workflows:** No support for bespoke state transitions (e.g., "Review → QA").

---

## **Functional Requirements**
| ID | Requirement | Priority |
|---|---|---|
| **FR-1** | System retrieves task data via OAuth/API keys for configured tools. | P0 |
| **FR-2** | Compute task age as `(current_time - timestamp_of_state_entry)`, excluding weekends/holidays (configurable). | P0 |
| **FR-3** | Dashboard displays:
   - Histogram of open tasks by aging bucket and state.
   - Table view with task ID, title, age, state, assignee, and labels.
   - Time-series trend of aging metrics (e.g., "# tasks >30d over past 90d"). | P0 |
| **FR-4** | User can filter dashboard by:
   - Project/team, workflow state, age range, assignee, label, priority.
   - Custom date ranges (e.g., "tasks that entered Backlog in Q3"). | P0 |
| **FR-5** | Alerts trigger when tasks exceed aging thresholds (e.g., "Backlog task X older than 14d"). Thresholds configurable per project/team. | P1 |
| **FR-6** | Export data to CSV/JSON with all dashboard fields + computed metadata (e.g., `days_since_last_update`). | P1 |
| **FR-7** | Benchmarking mode compares aging metrics to historical averages or team SLOs (e.g., "tasks are aging 20% slower than last quarter"). | P2 |
| **FR-8** | Annotations allow users to tag tasks with reasons for aging (e.g., "blocked on external team") via dashboard or API. | P2 |

---

## **Acceptance Criteria**
### **Core Functionality (MVP)**
✅ **Data Accuracy**
- Task age calculations match manual review for a sample of 100 tasks across all states.
- Aging buckets (`<7d`, `7–14d`, etc.) are correctly populated in dashboard.

✅ **Dashboard UX**
- Filters apply in <500ms for datasets ≤100k tasks.
- Default view shows aging distribution for user’s teams/projects.
- Trend charts render with tooltips showing exact metrics.

✅ **Alerts**
- Alerts fire within 1 hour of a task exceeding configured thresholds (tested with Slack + email).
- Alerts include task link, age, state, and assignee.

✅ **Performance**
- Dashboard loads in <2s for 95% of queries with filters applied.
- Data refresh latency ≤1 hour for new tasks/state changes.

### **Analytics**
✅ **Trends**
- Burndown charts accurately reflect changes in aging metrics (e.g., "tasks >30d decreased from 50 to 30").
- Benchmarking correctly highlights deviations from SLOs (e.g., "Backlog SLO violation: 25% of tasks >7d").

✅ **Exports**
- CSV/JSON export includes all dashboard fields plus computed aging metrics.
- Exports complete in <30s for datasets ≤100k tasks.

### **Edge Cases**
✅ **Handling:**
- Tasks with missing/invalid timestamps excluded from analysis.
- State transitions spanning weekends/holidays computed correctly.
- Deleted tasks purged from dashboard (configurable retention period).

### **Integration**
✅ **Jira/Linear/GitHub:**
- OAuth flow completes without errors.
- API rate limits handled gracefully (e.g., exponential backoff).
- Webhook-based incremental updates trigger data re-computation.

---