> **PRD** — drafted by Ada (Sr. Product Mgr) · task #150
> _Each agent that updates this PRD signs its change below._

# Project Health Scorecard PRD

## Problem & Goal
**Problem:**
Project leaders and product managers often rely on subjective assessments or incomplete data to evaluate project health. This leads to delayed risk identification, misaligned prioritization, and reactive management, increasing the likelihood of missed deadlines, budget overruns, or quality issues.

**Goal:**
Provide an **automated, objective, and comprehensive** project health scorecard that evaluates six critical dimensions (Schedule, Quality, Budget, Scope, Team, Risk) and synthesizes them into a single **composite health score (0-100)** with traffic-light indications (🟢/🟡/🔴). The scorecard will:
- Deliver **actionable insights** by surfacing underlying evidence (e.g., trends, ratios, comparisons).
- Enable **proactive decision-making** through trend analysis (improving/stable/declining).
- Support **historical benchmarking** to track progress over time.
- Reduce cognitive load by replacing gut feelings with data-driven assessments.

---

## Target Users / ICP Roles
| Role               | Jobs-to-be-Done (JTBD)                                                                 |
|--------------------|----------------------------------------------------------------------------------------|
| **Product Managers** | Track overall project health; identify risks early; communicate status to stakeholders. |
| **Engineering Managers** | Monitor team workload, quality trends, and sprint progress; address bottlenecks.       |
| **Program Managers**   | Align cross-functional teams on priorities; escalate risks to leadership.              |
| **Executive Sponsors** | Get at-a-glance visibility into project risks and mitigation status without deep dives. |
| **Scrum Masters**     | Ensure sprint predictability and workload balance; flag aging WIP.                     |

---

## Scope

### In Scope
1. **Automated Data Collection & Scoring Engine**
   - Integrate with existing tools (e.g., Jira, GitHub, Linear, Harvest, AWS Cost Explorer, CI/CD pipelines) to pull raw project data.
   - Calculate dimension-specific scores and an aggregated composite score (0-100) with traffic-light thresholds.

2. **Dimension-Specific Health Breakdowns**
   - **Schedule Health**
     - Metrics: Velocity trend, sprint predictability %, overdue tasks, deadline adherence.
     - Evidence: Burndown charts, milestone completion rate, task aging.
   - **Quality Health**
     - Metrics: Bug count/trend, open/closed ratio, regression rate, test coverage %.
     - Evidence: Defect leakage rate, escaped bugs, automated test pass/fail trends.
   - **Budget Health**
     - Metrics: Planned vs. actual spend, burn rate, forecast completion cost, token/AI spend efficiency.
     - Evidence: Spend trends, efficiency ratios (e.g., cost per story point).
   - **Scope Health**
     - Metrics: Scope creep %, epic completion %, new vs. completed work ratio.
     - Evidence: Change request volume, backlog growth rate.
   - **Team Health**
     - Metrics: Workload distribution, blockers, aging WIP, agent utilization %.
     - Evidence: Cycle time, WIP aging, team sentiment (if available).
   - **Risk Health**
     - Metrics: # of high-priority open risks, dependency risks, external blockers.
     - Evidence: Risk aging, mitigation progress, dependency maps.

3. **User Interface & Outputs**
   - **Dashboard View**: Composite score + per-dimension breakdown with evidence (charts, tables, or summaries).
   - **Trend Indicators**: Arrows (↑/→/↓) for each dimension to show improvement/stability/decline.
   - **Historical Snapshots**: Ability to compare current health with past periods (e.g., last 3 sprints).
   - **Export**: Option to export scorecard as PDF/PNG or shareable link.

4. **Alerting & Notifications**
   - Configurable thresholds for proactive alerts (e.g., "Quality trending ⬇️ for 2 sprints").
   - Integration with Slack/Teams/email for status changes (e.g., "Project X moved from 🟢 to 🟡").

5. **Customization**
   - Allow users to adjust dimension weights (e.g., prioritize Budget over Scope).
   - Enable exclusion of dimensions irrelevant to their project (e.g., token spend for non-AI projects).

### Out of Scope
- **Manual Data Entry**: Scores will rely on automated integrations; no support for manual input of metrics.
- **Predictive Forecasting**: No AI/ML-based predictions (e.g., "Project will fail in 3 sprints").
- **Root Cause Analysis**: Provides evidence but does not suggest remediation steps.
- **Multi-Project Rollups**: Focused on single-project health; no portfolio-level aggregation.
- **Integration with Non-Standard Tools**: Only supports widely adopted tools (Jira, GitHub, etc.); no custom API integrations for niche tools.
- **User-Specific Views**: No role-based customization (e.g., PMs vs. engineers see the same dashboard).

---

## Functional Requirements
| ID   | Requirement                                                                                     | Priority |
|------|-------------------------------------------------------------------------------------------------|----------|
| FR-1 | The system shall ingest project data from integrated tools (e.g., Jira, GitHub) on a daily basis. | P0       |
| FR-2 | The system shall calculate a composite health score (0-100) based on 6 dimensions, using configurable weights. | P0       |
| FR-3 | The system shall map the composite score to traffic-light thresholds (0-49: 🔴, 50-74: 🟡, 75-100: 🟢). | P0       |
| FR-4 | For each dimension, the system shall display a score (0-100) and a trend indicator (↑/→/↓).        | P0       |
| FR-5 | For each dimension, the system shall provide evidence (metrics, charts, or tables) explaining the score. | P0       |
| FR-6 | The system shall store historical snapshots of scores to enable trend comparisons.                | P0       |
| FR-7 | The system shall support user-defined weight adjustments per dimension (default: equal weights).  | P1       |
| FR-8 | The system shall allow users to exclude irrelevant dimensions from the score calculation.         | P1       |
| FR-9 | The system shall generate alerts when a dimension’s score changes threshold (e.g., 🟢 → 🟡).       | P1       |
| FR-10 | The system shall provide an export option (PDF/PNG/shareable link) for the scorecard.              | P2       |
| FR-11 | The system shall display a 30-day trend graph for each dimension’s score.                          | P2       |
| FR-12 | The system shall support integration with Slack/Teams/email for notifications.                    | P2       |

---

## Acceptance Criteria
### Automated Scoring Engine
- [ ] The system computes a composite score (0-100) and dimension-specific scores without manual intervention.
- [ ] Scores are recalculated daily (or on-demand if data refreshes more frequently).
- [ ] Dimension scores can be weighted (default: equal distribution) or excluded via user configuration.

### Traffic-Light Thresholds
- [ ] Composite score is displayed with a 🟢/🟡/🔴 indicator based on thresholds (0-49: 🔴, 50-74: 🟡, 75-100: 🟢).
- [ ] Each dimension score includes a trend indicator (↑/→/↓) based on the last 3 data points.

### Evidence & Transparency
- [ ] Each dimension score is accompanied by at least 2 supporting metrics/charts (e.g., "Schedule: 60% sprint predictability → 🟡, overdue tasks ↑").
- [ ] Users can drill down into a dimension to view detailed evidence (e.g., burstdown chart for Schedule).

### Historical Snapshots
- [ ] Users can view/compare the current scorecard with historical snapshots (e.g., last sprint, last month).
- [ ] Snapshots are retained for at least 6 months.

### Alerts & Notifications
- [ ] Users receive alerts when a dimension or composite score crosses a threshold (e.g., 🟢 → 🟡).
- [ ] Alerts include the dimension, score, trend, and evidence summary.
- [ ] Alerts are customizable (e.g., disable for specific dimensions).

### Export & Sharing
- [ ] Users can export the scorecard as a PDF or PNG, or generate a shareable link.
- [ ] Exports include all dimensions, scores, trend indicators, and evidence.

### Performance
- [ ] Scorecard generation completes within 10 seconds for a project with ≤1,000 tasks/issues.
- [ ] Historical snapshot comparisons load within 5 seconds.

### Integration
- [ ] The system supports integration with at least 3 tools (e.g., Jira + GitHub + Harvest).
- [ ] Data ingestion fails gracefully (e.g., notifies user if Jira API is down) and does not block scorecard generation for other dimensions.