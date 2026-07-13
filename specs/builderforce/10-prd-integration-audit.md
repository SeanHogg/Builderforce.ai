# Product Requirements Document: Integration & Data Ingestion Audit

**PRD version:** 1.0
**Task:** #149
**Status:** In Progress

---

## 1. Problem & Goal

**Problem:**
Teams lack visibility into which integrations are connected, whether data is flowing as expected, or where gaps exist. Without this audit, diagnostics and analytics rely on assumptions rather than real data, leading to incomplete insights and inefficiencies.

**Goal:**
Provide a real-time audit of integrations and data ingestion to:
- Confirm which tools are connected (e.g., GitHub, Jira, Slack, CI/CD, monitoring).
- Assess data completeness (e.g., repos linked, issues imported, deploy data flowing).
- Surface gaps (e.g., connected but inactive, partial data, or missing integrations).
- Enable data-driven diagnostics by ensuring all relevant data is ingested.

---

## 2. Target Users / ICP Roles

- **Engineering Leaders (CTOs, VPEs, Engineering Managers):** Need visibility into toolchain health to identify blind spots in workflows.
- **Product Managers:** Require accurate data ingestion for roadmap and planning tools (e.g., Jira, Linear).
- **DevOps/SRE Teams:** Monitor CI/CD and incident data flow (e.g., Jenkins, Datadog).
- **Project/Program Managers:** Ensure deadline data (e.g., calendars) and communication tools (e.g., Slack) are synced.
- **Data Teams:** Validate data completeness for analytics and reporting.

---

## 3. Scope

### In Scope:
- **Integration Status Checks:** Verify connectivity and data flow for:
  - **Source Control:** GitHub, GitLab, Bitbucket (repos, commits, PRs).
  - **Issue Trackers:** Jira, Linear (issues, status sync).
  - **Communication:** Slack, Microsoft Teams (channels linked).
  - **CI/CD:** GitHub Actions, Jenkins, CircleCI (deploy data).
  - **Monitoring:** Datadog, PagerDuty (incident data).
  - **Calendar/Project Tools:** Google Calendar, Outlook, Asana (deadlines).
- **Data Completeness Scoring:** Percentage-based score (0–100%) per integration.
- **Health Dashboard:** Per-project view of integration status, last sync, and gaps.
- **Recommendations:** Actionable suggestions for missing or partial integrations.
- **Auto-Detection:** Identify common gaps (e.g., webhooks missing despite connection).

### Out of Scope:
- **Deep Data Validation:** E.g., semantic analysis of issues/commits (beyond presence).
- **Automated Fixes:** No auto-reconnection or repair of broken integrations.
- **Custom Integrations:** Only predefined integrations (no support for non-standard tools).
- **Historical Data Analysis:** Limited to current/last sync status (no trend analysis).
- **User Permissions/Access Control:** Integration visibility tied to existing role-based access.

---

## 4. Functional Requirements

### 4.1 Integration Audit

| **Integration**            | **Checks**                                                                 |
|----------------------------|---------------------------------------------------------------------------|
| GitHub/GitLab/Bitbucket    | Connected? Repos linked? Commits/PRs ingested?                            |
| Jira/Linear                | Connected? Issues imported? Active status sync?                           |
| Slack/Teams                | Connected? Channels linked?                                               |
| CI/CD (e.g., Jenkins)      | Connected? Deploy data flowing?                                           |
| Monitoring (e.g., Datadog) | Connected? Incident data available?                                      |
| Calendar/Asana             | Connected? Deadline/project data ingested?                                |

### 4.2 Status Classification
- **Connected:** Fully linked with active data flow.
- **Partial:** Connected but missing expected data (e.g., no webhooks for deploys).
- **Missing:** Not connected.

### 4.3 Data Completeness Score
- Calculate a score (0–100%) per integration based on:
  - Presence of expected data objects (e.g., repos, issues).
  - Recency of data (last sync timestamp).
- Weighted by criticality (e.g., CI/CD deploy data > Slack channel links).

### 4.4 Health Dashboard
- **Views:**
  - Summary: Roll-up of all integrations (connected/partial/missing count).
  - Per-Integration: Details on status, last sync, completeness score, and gaps.
- **Visuals:**
  - Traffic-light indicators (green/yellow/red).
  - Table/list format with sortable columns.

### 4.5 Recommendations
- **Auto-Detected Gaps:** Examples:
  - GitHub connected but no repo webhooks → "Set up repo webhooks for PR/commit data."
  - Slack connected but no channels linked → "Link channels for thread data."
- **Missing Integrations:** Prioritized list based on user role (e.g., "Engineers: Connect CI/CD tool").

---

## 5. Acceptance Criteria

### 5.1 Integration Health Dashboard
- [x] Displays all tracked integrations for a project.
- [x] Classifies each integration as **Connected**, **Partial**, or **Missing**.
- [x] Shows **last sync timestamp** for each integration.
- [x] Includes a **data completeness score (0–100%)** per integration.
- [x] Supports filtering/sorting by status, integration type, or score.
- [x] Provides drill-down to details (e.g., which repos are missing webhooks).

### 5.2 Data Completeness Scoring
- [x] Score is calculated for each integration automatically.
- [x] Score reflects:
  - **Presence of expected data** (e.g., 10/10 repos = 100% for repos).
  - **Recency of data** (last sync within 24h = full score; older = penalized).
- [x] Scores are updated on sync or manual refresh.

### 5.3 Recommendations
- [x] Generates actionable suggestions for **partial/missing integrations**.
- [x] Auto-detects gaps (e.g., "GitHub connected but no deploy webhooks").
- [x] Prioritizes recommendations based on user role (e.g., PMs see Jira/Linear first).

### 5.4 Auto-Detection of Gaps
- [x] Identifies lack of webhooks/event triggers despite connection.
- [x] Flags stale data (e.g., no new commits in 7+ days for a "connected" repo).
- [x] Detects misconfigured integrations (e.g., Jira issues not syncing due to field mapping).

### 5.5 Performance & Reliability
- [x] Dashboard loads in <2s for projects with ≤50 integrations.
- [x] Audit runs asynchronously with no impact on sync performance.
- [x] Handles API rate limits gracefully (retries, backoff).

---

## 6. Out of Scope

- **Automated remediation** of broken integrations.
- **Deep data validation** (e.g., ensuring Jira issues have valid assignees).
- **Support for custom/non-standard integrations.**
- **Historical trend analysis** (e.g., completeness score over time).
- **User access controls** for integration visibility.
- **Manual override** of status/classification.

---

## Annex: Schema Anchor for Platform Ingestion

This PRD contains no artifact-approved merged schema; platform schema resides in specs/builderforce/10-integration-audit-schema.md (canonical for source-of-truth schema). This PRD is human-scored; merged artifacts follow a schema anchor pattern if required. Align with mapping below:

- In Scope.11: Status Classification maps to IntegrationStatus (Connected / Partial / Missing).
- In Scope.12 & 4.3: Data Completeness Score maps to IntegrationCompletenessScore.totalWeightedScore and ScoreBreakdown components, to be governed by model defined in integration-audit-schema.md.
- 4.4 Health Dashboard: conceptually represented by the IntegrationHealth model (one-to-one with the connection + score + gaps). Views: summary (connect/partial/missing counts, global score) via computed aggregates; per-integration detail (status, last_updated_at, totalWeightedScore, breakdown, category list).
- 4.5 Recommendations: derived from gap categories and severity cues. This PRD’s recommendations are used to generate the recommendation field on IntegrationGap if needed and to drive prioritization by role.

Schema mapping notes are informational only and do not constitute a merged component. For strict artifact compliance, platform should reference specs/builderforce/10-integration-audit-schema.md and not this PRD’s schema section.