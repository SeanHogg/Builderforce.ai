> **PRD** — drafted by Ada (Sr. Product Mgr) · task #147
> _Each agent that updates this PRD signs its change below._

# PRD: Project Health Diagnostic & Resolution — Red-to-Green Onboarding

## Problem & Goal

### Problem
Engineering managers, delivery leads, and project sponsors lack a fast, structured way to assess the true health of a project at any point in time. Critical signals — missed deadlines, bloated backlogs, budget overruns, stale overdue items, rising defect rates, and mis-sized resource estimates — live in disparate tools. Teams spend hours manually aggregating data and still arrive at subjective, inconsistent health assessments with no clear remediation path.

### Goal
Deliver a guided onboarding/diagnostic flow that:
1. Asks the right questions to frame project context.
2. Automatically ingests data from connected integrations.
3. Computes an objective **Red / Amber / Green (RAG)** health score across six health dimensions.
4. Generates a concrete, AI-driven **Resolution Plan** with prioritised actions to move the project from its current RAG status toward Green.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager | Fast signal on sprint/backlog/team health without manual report assembly |
| Delivery Lead / Scrum Master | Identify blockers and at-risk items early; produce stakeholder-ready status |
| Project Sponsor / VP Engineering | Portfolio-level RAG visibility and accountability on remediation |
| PMO Analyst | Consistent, repeatable health methodology across multiple projects |

---

## Scope

### In Scope
- Onboarding diagnostic wizard (question flow + integration pull)
- Six health dimension assessments (see Functional Requirements)
- RAG scoring engine with configurable thresholds
- AI-generated Resolution Plan per project
- Dashboard view showing current RAG status per dimension
- Exportable health report (PDF / shareable link)
- Support for initial integration set: Jira, Linear, GitHub, GitLab, Asana, Harvest/Toggl (time & budget), and manual CSV import

### Out of Scope
- Real-time continuous monitoring / alerting (post-MVP)
- Native mobile application (post-MVP)
- Financial forecasting beyond burn-rate analysis
- HR / performance management workflows
- Multi-currency budget support (MVP assumes single currency)
- Integrations beyond the listed initial set

---

## Functional Requirements

### 1. Guided Onboarding Diagnostic Wizard

**FR-1.1** The wizard MUST present a structured question flow covering:
- Project name, type (software, ops, mixed), and target go-live date
- Current team size and role breakdown
- Budget allocated vs. budget consumed to date
- Primary project management and source-control tools in use
- Self-reported pain points (multi-select: deadline risk, backlog quality, budget, overdue items, bugs, resourcing)

**FR-1.2** The wizard MUST support skipping individual questions with a "pull from integration" fallback where data can be inferred automatically.

**FR-1.3** On wizard completion the system MUST trigger automated data ingestion from all authorised integrations and surface a completion confidence score (% of dimensions with sufficient data).

---

### 2. Integration Data Ingestion

**FR-2.1** The system MUST connect to at least one project management tool (Jira, Linear, or Asana) to pull: open issues, issue age, sprint velocity, cycle time, and blocked items.

**FR-2.2** The system MUST connect to at least one source-control tool (GitHub or GitLab) to pull: open PRs, PR age, failed CI runs in the last 14 days, and open bug/defect issues.

**FR-2.3** The system MUST connect to at least one time-tracking/budget tool (Harvest or Toggl) or accept a manual budget CSV to pull: hours logged, estimated hours remaining, and budget consumed percentage.

**FR-2.4** All integration data MUST be refreshed on-demand (user-triggered) and MUST display a "last synced" timestamp.

**FR-2.5** Where an integration is unavailable, the system MUST allow manual data entry for each health dimension so the diagnostic can still complete.

---

### 3. Health Dimension Assessment Engine

The engine MUST evaluate six dimensions and assign each a RAG status independently.

#### 3.1 Deadline Tracking
- Compares current date, remaining scope (open issues × average cycle time), and target go-live.
- **Green**: on track with ≥10% schedule buffer. **Amber**: buffer 0–10% or velocity trending down. **Red**: projected completion exceeds go-live date or velocity has dropped >20% over the last two sprints.

#### 3.2 Backlog Health
- Evaluates backlog size relative to team capacity, % of issues older than 90 days, and % of issues lacking estimates.
- **Green**: <20% aged issues, <15% unestimated. **Amber**: 20–40% aged or 15–30% unestimated. **Red**: >40% aged or >30% unestimated.

#### 3.3 Budget & Burn Rate
- Compares spend to date against planned spend for the elapsed timeline percentage.
- **Green**: spend within ±10% of plan. **Amber**: overspend 10–20% or underspend suggesting delivery risk. **Red**: overspend >20% or projected overrun confirmed.

#### 3.4 Overdue Items
- Counts issues past their due date or issues in "In Progress" status for longer than 2× the team's median cycle time.
- **Green**: <5% of active items overdue. **Amber**: 5–15%. **Red**: >15%.

#### 3.5 Quality & Bugs
- Tracks open bug count, bug-to-story ratio in the current sprint, and CI failure rate.
- **Green**: bug ratio <10%, CI failure rate <5%. **Amber**: bug ratio 10–25% or CI failure 5–15%. **Red**: bug ratio >25% or CI failure >15%.

#### 3.6 Resource Estimation Accuracy
- Compares original estimates to actuals for completed issues in the last 30 days.
- **Green**: median estimation error <20%. **Amber**: 20–40% error. **Red**: >40% error or <5 completed issues available for analysis (insufficient data).

**FR-3.7** The system MUST compute an **Overall Project RAG** as the worst single-dimension status, with a weighted composite score displayed as a secondary indicator.

**FR-3.8** All thresholds listed above MUST be configurable by workspace admins.

---

### 4. AI-Driven Resolution Plan

**FR-4.1** Upon diagnostic completion, the system MUST generate a Resolution Plan containing:
- An executive summary (≤150 words) of overall project health.
- A ranked list of **Action Items** (maximum 10), each specifying: dimension addressed, recommended action, suggested owner role, estimated effort (S/M/L), and expected RAG impact.
- A **30-day roadmap** of sequenced steps to move each Red dimension to Amber and each Amber to Green.

**FR-4.2** Action Items MUST be generated by an LLM using project context, dimension scores, and retrieved integration data as grounding. The model MUST NOT hallucinate issue IDs or budget figures; all referenced data points MUST trace back to ingested data.

**FR-4.3** Each Action Item MUST display the data evidence that triggered it (e.g., "14 issues have been In Progress >21 days — 2× your median cycle time of 10 days").

**FR-4.4** Users MUST be able to accept, dismiss, or defer individual Action Items; dismissed items MUST be retained in an audit log.

**FR-4.5** Accepted Action Items MUST be exportable as tasks to connected project management tools (Jira, Linear, Asana).

---

### 5. Health Dashboard

**FR-5.1** The dashboard MUST display a RAG card per dimension with current status, primary metric, and trend arrow (vs. last diagnostic run).

**FR-5.2** The dashboard MUST show a project timeline bar indicating elapsed time vs. remaining scope.

**FR-5.3** The dashboard MUST support running a new diagnostic at any time; historical diagnostic snapshots MUST be stored and browsable.

---

### 6. Reporting & Export

**FR-6.1** Users MUST be able to export a Health Report as a PDF containing: overall RAG, per-dimension scores, key metrics, and the Resolution Plan.

**FR-6.2** The system MUST generate a shareable, read-only link to the current diagnostic snapshot (link expires in 30 days by default, configurable).

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | A user completing the full wizard for the first time, with at least one PM integration and one SCM integration authorised, reaches a fully scored RAG dashboard in ≤3 minutes (excluding OAuth consent screens). |
| AC-02 | Every health dimension displays a RAG status after wizard completion; no dimension may show "insufficient data" if the corresponding integration is connected and returns ≥10 relevant records. |
| AC-03 | The Overall Project RAG equals the worst dimension status in 100% of test cases. |
| AC-04 | The Resolution Plan is generated within 30 seconds of diagnostic completion and contains a minimum of 3 and a maximum of 10 Action Items. |
| AC-05 | Every Action Item includes at least one data citation referencing a specific metric value sourced from ingested integration data. |
| AC-06 | Threshold overrides saved by a workspace admin are reflected in the next diagnostic run and in the UI threshold display. |
| AC-07 | Accepted Action Items pushed to Jira/Linear/Asana appear in the target tool within 60 seconds and include the action description and suggested owner role as assignee label. |
| AC-08 | PDF export renders correctly (no missing sections, no raw JSON) and is ≤5 MB for a standard 10-action resolution plan. |
| AC-09 | Manual data entry fallback for any disconnected dimension produces a valid (non-null) RAG status for that dimension. |
| AC-10 | Historical diagnostic snapshots are retrievable up to 90 days after creation. |

---

## Out of Scope

- Continuous background monitoring, webhooks, or push-based alerting for health changes
- Native iOS / Android application
- Multi-project portfolio roll-up and cross-project dependency analysis
- Automated execution of remediation actions (the plan is advisory only in MVP)
- Integration with ITSM tools (ServiceNow, Zendesk) or CRM systems
- Multi-currency or multi-entity financial reporting
- SSO / SCIM provisioning (handled by separate Identity epic)
- Custom AI model fine-tuning or bring-your-own-LLM configuration
- SLA/compliance reporting frameworks (SOC 2, ISO evidence packs)