> **PRD** — drafted by Mike QA (Tester V2 (Durable) · task #136
> _Each agent that updates this PRD signs its change below._

# PRD: OKR 3 — Dev Analytics & Team Intelligence (DevDynamics)

---

## 1. Problem & Goal

Engineering teams lack a single source of truth for individual and team productivity. Activity data is fragmented across Git hosts, issue trackers, and project management tools — forcing managers to manually reconcile data, write status updates, and compile reports. This creates reporting lag, blind spots in contributor performance, and no scalable path toward agentic workflow automation.

**Goal:** Build DevDynamics as the system-of-record for engineering productivity by ingesting cross-platform activity data, resolving contributor identities, and auto-generating insights that replace manual reporting — laying the foundation for fully agentic engineering workflows.

---

## 2. Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Engineering Manager** | Daily standup summaries, team-level throughput visibility, contributor health signals |
| **VP / Head of Engineering** | Executive summaries, cross-team trend reporting, bottleneck identification |
| **Individual Contributor (IC)** | Personal activity log, contribution visibility, self-service profile |
| **Platform / DevOps Admin** | Integration configuration, identity mapping, pipeline health monitoring |

---

## 3. Scope

### In Scope
- Cross-platform identity reconciliation (unified contributor profile)
- Activity ingestion pipeline (commits, PRs, issues)
- Integrations: **GitHub**, **Bitbucket**, **Jira**
- Auto-generated **daily standup reports** and **executive summary reports**
- **Activity log dashboard** (team-level view)
- **Contributor detail page** (individual-level view)

### Out of Scope *(see Section 8)*
- CI/CD pipeline metrics (build times, deploy frequency)
- Slack / communication platform ingestion
- Code quality / static analysis signals
- Compensation or performance review workflows
- Mobile application

---

## 4. Functional Requirements

### 4.1 Cross-Platform Identity Reconciliation
- **FR-1.1** The system MUST ingest user identity signals from GitHub (username + email), Bitbucket (username + email), and Jira (account ID + email).
- **FR-1.2** The system MUST automatically merge identities sharing a verified email address into a single **Unified Contributor Profile**.
- **FR-1.3** Admins MUST be able to manually link or unlink identities that cannot be auto-resolved (e.g., mismatched emails across platforms).
- **FR-1.4** Each Unified Contributor Profile MUST expose: display name, avatar, linked platform accounts, team/org membership, and aggregate activity stats.

### 4.2 Activity Ingestion Pipeline
- **FR-2.1** The pipeline MUST ingest the following event types:

  | Source | Events |
  |---|---|
  | GitHub / Bitbucket | commit pushed, PR opened, PR reviewed, PR merged, PR closed |
  | Jira | issue created, issue updated, issue transitioned, issue assigned, comment added |

- **FR-2.2** Ingestion MUST support both **webhook (real-time)** and **scheduled polling (catch-up / backfill)** modes.
- **FR-2.3** The pipeline MUST be idempotent — duplicate events from retries or polling overlaps MUST NOT create duplicate records.
- **FR-2.4** Raw events MUST be stored with full provenance (source, timestamp, raw payload) before normalization.
- **FR-2.5** Normalized events MUST be linked to the resolved Unified Contributor Profile at write time.
- **FR-2.6** Pipeline lag from event occurrence to availability in the dashboard MUST be ≤ 15 minutes under normal load for webhook-sourced events.

### 4.3 Integrations

#### 4.3.1 GitHub Integration
- **FR-3.1** OAuth 2.0 App installation flow for GitHub Organizations.
- **FR-3.2** Ingest repos, contributors, commits, pull requests, and PR reviews within the authorized org scope.
- **FR-3.3** Support GitHub Cloud; GitHub Enterprise Server is out of scope for v1.

#### 4.3.2 Bitbucket Integration
- **FR-3.4** OAuth 2.0 App installation flow for Bitbucket Workspaces.
- **FR-3.5** Ingest repos, contributors, commits, and pull requests within the authorized workspace scope.
- **FR-3.6** Support Bitbucket Cloud; Bitbucket Data Center is out of scope for v1.

#### 4.3.3 Jira Integration
- **FR-3.7** OAuth 2.0 / Atlassian Connect installation flow for Jira Cloud.
- **FR-3.8** Ingest projects, issues, transitions, assignees, reporters, and comments within authorized project scope.
- **FR-3.9** Map Jira issue types (Story, Bug, Task, Sub-task, Epic) to a normalized internal taxonomy.

### 4.4 Auto-Generated Reports

#### 4.4.1 Daily Standup Report
- **FR-4.1** The system MUST generate a per-team Daily Standup Report once per configurable schedule (default: 09:00 local team timezone, Monday–Friday).
- **FR-4.2** Report content MUST include, per contributor:
  - PRs opened, reviewed, and merged (last 24 h)
  - Commits pushed (last 24 h)
  - Jira issues transitioned or commented on (last 24 h)
  - Blockers inferred from PRs open > configurable threshold (default: 2 days) without review
- **FR-4.3** Report MUST be delivered via in-app notification; email delivery is a stretch goal for v1.
- **FR-4.4** Report output MUST be human-readable narrative (LLM-generated summary prose) AND a structured data table.

#### 4.4.2 Executive Summary Report
- **FR-4.5** The system MUST generate a per-org Weekly Executive Summary (default: Monday 08:00 local org timezone).
- **FR-4.6** Report content MUST include:
  - Team-level PR throughput (opened / merged / cycle time)
  - Issue completion rate vs. prior week
  - Top contributors by activity (configurable metric)
  - Teams or contributors with anomalous low activity (configurable threshold)
- **FR-4.7** Report MUST be accessible in-app and exportable as PDF and Markdown.
- **FR-4.8** LLM-generated narrative summary (≤ 300 words) MUST accompany the data.

### 4.5 Activity Log Dashboard
- **FR-5.1** The dashboard MUST display a chronological, filterable feed of all ingested activity events across the org.
- **FR-5.2** Filters MUST include: date range, contributor, team, platform (GitHub / Bitbucket / Jira), and event type.
- **FR-5.3** Dashboard MUST include aggregate metric cards: total commits, PRs merged, issues closed, and active contributors for the selected period.
- **FR-5.4** Dashboard data MUST refresh automatically (polling interval ≤ 60 seconds or via WebSocket push).
- **FR-5.5** Dashboard MUST support pagination or infinite scroll for event feed with ≥ 10,000 visible events without performance degradation.

### 4.6 Contributor Detail Page
- **FR-6.1** Each Unified Contributor Profile MUST have a publicly accessible (within-org) detail page.
- **FR-6.2** The page MUST display:
  - Profile header: avatar, name, linked platform identities, team, role
  - Activity timeline (all events, filterable by type and date range)
  - Metric summary panel: commits, PRs, reviews, issues (7 / 30 / 90-day windows)
  - PR cycle time trend (rolling 30-day chart)
  - Jira issue throughput trend (rolling 30-day chart)
- **FR-6.3** Contributors MUST be able to view their own page; managers MUST be able to view any contributor in their org.
- **FR-6.4** The page MUST link back to source artifacts (e.g., direct link to PR on GitHub, issue on Jira).

---

## 5. Acceptance Criteria

| ID | Criterion | Verification Method |
|---|---|---|
| AC-1 | A contributor with the same email on GitHub and Jira is automatically merged into one Unified Profile with zero manual intervention | Automated integration test |
| AC-2 | An admin can manually link two contributor accounts with different emails within 3 clicks | Manual QA walkthrough |
| AC-3 | A commit event pushed to GitHub appears in the Activity Log dashboard within 15 minutes | Synthetic monitoring test |
| AC-4 | Ingesting the same webhook event twice produces exactly one stored record | Unit + integration test |
| AC-5 | Daily Standup Report is generated and visible in-app by the configured schedule time ± 5 minutes | Automated scheduler test |
| AC-6 | Executive Summary PDF export contains all required sections and renders without errors | Automated + manual QA |
| AC-7 | Activity Log dashboard loads within 3 seconds (p95) with 10,000 events in the selected date range | Load test |
| AC-8 | Contributor Detail Page renders all metric panels within 2 seconds (p95) | Load test |
| AC-9 | Connecting a GitHub Org via OAuth and completing first data sync requires ≤ 10 minutes end-to-end for orgs with ≤ 500 repos | Timed manual test |
| AC-10 | All ingested events are linkable back to their source artifact URL | Automated data integrity check |
| AC-11 | Role-based access control prevents an IC from viewing another contributor's detail page outside their own org | Security test |

---

## 6. Non-Functional Requirements

- **Security:** All OAuth tokens MUST be stored encrypted at rest (AES-256). Platform credentials MUST never be logged.
- **Privacy:** Contributor data MUST be scoped to the org; no cross-org data leakage. GDPR-compliant data deletion on org offboarding.
- **Scalability:** Ingestion pipeline MUST handle burst ingestion of 50,000 events/hour without data loss (queue-backed architecture required).
- **Reliability:** Ingestion pipeline uptime target ≥ 99.5% monthly. Failed webhook deliveries MUST be retried with exponential backoff (max 5 attempts).
- **Observability:** Pipeline MUST emit structured logs and metrics for queue depth, processing latency, error rate, and identity resolution match rate.

---

## 7. Dependencies & Assumptions

- LLM API (e.g., OpenAI / Anthropic) available for report narrative generation; prompt engineering is part of delivery scope.
- Organization and Team data model already exists in the platform or will be created as part of this OKR.
- Rate limits on GitHub REST API (~5,000 req/hr per token) and Jira Cloud API are accepted constraints; backfill jobs MUST respect and honor them.
- Bitbucket Cloud webhooks support the required event types (assumed verified pre-implementation).
- PDF export relies on a server-side rendering library (e.g., Puppeteer or equivalent); licensing is pre-approved.

---

## 8. Out of Scope

- GitHub Enterprise Server and Bitbucket Data Center (v1 excludes self-hosted variants)
- GitLab integration
- CI/CD metrics (build duration, deployment frequency, change failure rate)
- Slack, Teams, or email communication ingestion
- Code review quality scoring or static analysis integration
- Sprint planning, capacity forecasting, or roadmap tooling
- Compensation, leveling, or formal performance review workflows
- Native mobile (iOS / Android) application
- Multi-region data residency (single-region v1)
- Custom report builder / ad-hoc query interface

---

*Document status: **WIP — v0.1***
*Last updated: 2025*
*Owner: Product — Platform Intelligence*