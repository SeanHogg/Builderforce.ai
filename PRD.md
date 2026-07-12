> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #310
> _Each agent that updates this PRD signs its change below._

# PRD: Canonical Integration Set

## Problem & Goal

Engineering teams operate across a fragmented toolchain — project tracking, version control, communication, CI/CD pipelines, and observability platforms each live in isolated silos. Context-switching and manual cross-referencing between these tools creates toil, delays incident response, and obscures the true health of delivery workflows.

**Goal:** Define a canonical, first-class integration set that the platform will support at launch — establishing clear contracts, scope, and acceptance criteria for each integration so that downstream agents (implementation, QA, docs) operate from a single source of truth.

---

## Target Users / ICP Roles

| Role | Primary Tools Used | Integration Need |
|---|---|---|
| Software Engineer | GitHub, Linear/Jira, Slack | PR-to-issue linking, CI status, alert triage |
| Engineering Manager | Jira, Linear, Datadog, Slack | Delivery visibility, cycle time, incident impact |
| DevOps / Platform Engineer | GitHub Actions, Sentry, Datadog | Pipeline health, error budgets, deployment tracking |
| Product Manager | Jira, Linear, Slack | Roadmap status, release readiness |
| On-call Responder | PagerDuty (future), Sentry, Datadog, Slack | Rapid incident context, correlated signals |

---

## Scope

### In-Scope Integrations (v1 Canonical Set)

| Category | Tool(s) |
|---|---|
| Project Tracking | Jira, Linear |
| Version Control | GitHub |
| Communication | Slack |
| CI/CD | GitHub Actions |
| Observability — Error Tracking | Sentry |
| Observability — Metrics & APM | Datadog |

All six categories must be covered. Jira and Linear are treated as parallel implementations within the same project-tracking integration contract.

---

## Functional Requirements

### FR-1 · Jira Integration
- **FR-1.1** Authenticate via OAuth 2.0 (3-legged) against a user-specified Jira Cloud site.
- **FR-1.2** Read and write Issues: create, update status, add comments, attach links.
- **FR-1.3** Read Projects, Boards, and Sprints to provide delivery context.
- **FR-1.4** Emit a normalized `Issue` event on create, update, and status-change.
- **FR-1.5** Support JQL-based querying for issue retrieval.
- **FR-1.6** Receive and process inbound webhooks for issue events (created, updated, deleted, transitioned).

### FR-2 · Linear Integration
- **FR-2.1** Authenticate via OAuth 2.0 against Linear's API.
- **FR-2.2** Read and write Issues: create, update state, add comments, attach URLs.
- **FR-2.3** Read Teams, Cycles (sprints), and Projects.
- **FR-2.4** Emit the same normalized `Issue` event schema as FR-1.4.
- **FR-2.5** Receive and process Linear webhooks for issue and project events.

### FR-3 · GitHub Integration
- **FR-3.1** Authenticate via GitHub App installation (preferred) or OAuth 2.0.
- **FR-3.2** Read Repositories, Branches, Commits, Pull Requests, and Reviews.
- **FR-3.3** Write PR comments and status checks.
- **FR-3.4** Link Pull Requests to normalized `Issue` events (by branch name convention or explicit reference).
- **FR-3.5** Receive and process GitHub webhooks: `push`, `pull_request`, `pull_request_review`, `check_run`, `workflow_run`.
- **FR-3.6** Expose repository and PR metadata via a normalized `ChangeSet` event.

### FR-4 · Slack Integration
- **FR-4.1** Authenticate via Slack OAuth 2.0 (Bot Token with required scopes: `chat:write`, `channels:read`, `users:read`).
- **FR-4.2** Post messages and threaded replies to channels or DMs.
- **FR-4.3** Support Block Kit message formatting for rich notifications.
- **FR-4.4** Receive and route inbound slash commands and interactive component payloads (button clicks, select menus).
- **FR-4.5** Resolve Slack user identities to platform user records.
- **FR-4.6** Support configurable per-workspace channel routing rules.

### FR-5 · GitHub Actions (CI/CD) Integration
- **FR-5.1** Ingest `workflow_run` and `check_run` webhook events from GitHub (reuses the GitHub App from FR-3.1; no separate auth required).
- **FR-5.2** Normalize pipeline events into a `PipelineRun` schema: `{id, workflow, branch, commit_sha, status, duration_ms, triggered_by, steps[]}`.
- **FR-5.3** Detect and surface build failures with a link to the failing step's log URL.
- **FR-5.4** Correlate `PipelineRun` events to the `ChangeSet` from FR-3.6 via `commit_sha`.
- **FR-5.5** Expose a summary of pipeline health (pass rate, mean duration, flake rate) queryable over a configurable time window.

### FR-6 · Sentry Integration (Observability — Error Tracking)
- **FR-6.1** Authenticate via Sentry Internal Integration token (project-scoped API key).
- **FR-6.2** Receive inbound Sentry webhooks for `issue.created`, `issue.resolved`, `issue.assigned`, and `error-alert` events.
- **FR-6.3** Read Sentry Issues and Events via REST API to enrich alert payloads.
- **FR-6.4** Normalize error events into an `ObservabilityAlert` schema: `{id, source:"sentry", severity, title, project, environment, first_seen, url}`.
- **FR-6.5** Correlate Sentry releases (via `release` tag) to `PipelineRun` and `ChangeSet` records.
- **FR-6.6** Support automatic creation of a linked Jira/Linear issue from a Sentry alert (configurable per project).

### FR-7 · Datadog Integration (Observability — Metrics & APM)
- **FR-7.1** Authenticate via Datadog API Key + Application Key pair (organization-scoped).
- **FR-7.2** Receive inbound Datadog webhook notifications for Monitor alerts (triggered, recovered, no-data).
- **FR-7.3** Query Datadog Metrics API to retrieve time-series data on demand (used for incident enrichment).
- **FR-7.4** Normalize monitor alert events into the same `ObservabilityAlert` schema as FR-6.4 (`source:"datadog"`).
- **FR-7.5** Ingest Deployment Events from Datadog Events API to correlate deploys with metric regressions.
- **FR-7.6** Support configurable alert-routing rules: route `ObservabilityAlert` events to Slack channels and/or auto-create project-tracker issues based on severity and team tag.

---

## Acceptance Criteria

### AC-1 · Jira
- [ ] A user can connect a Jira Cloud workspace via OAuth flow in under 60 seconds.
- [ ] Creating an issue via the platform API results in a real Jira issue within 5 seconds (p95).
- [ ] An inbound Jira webhook transition event updates the internal issue state within 10 seconds (p95).
- [ ] Normalized `Issue` events from Jira and Linear are schema-compatible (same required fields, same enum values for `status` states).

### AC-2 · Linear
- [ ] A user can connect a Linear workspace via OAuth flow in under 60 seconds.
- [ ] All AC-1 timing and schema requirements apply identically to Linear.

### AC-3 · GitHub
- [ ] GitHub App installation flow completes without requiring a GitHub organization admin to perform manual steps beyond approving the installation.
- [ ] A pull request opened against a branch matching pattern `<issue-id>-*` is automatically linked to the corresponding Jira or Linear issue.
- [ ] `ChangeSet` events appear in the platform within 15 seconds of a `push` or `pull_request` webhook being dispatched by GitHub.

### AC-4 · Slack
- [ ] A bot message is delivered to the target channel within 5 seconds of a triggering event.
- [ ] An interactive button click in Slack is acknowledged (HTTP 200) within 3 seconds and processed within 10 seconds.
- [ ] Deactivating a Slack workspace connection stops all outbound messages to that workspace immediately.

### AC-5 · GitHub Actions
- [ ] `PipelineRun` records are created within 30 seconds of a `workflow_run` completion webhook.
- [ ] A failing workflow surfaces the specific failed step name and direct log URL in the normalized record.
- [ ] Pipeline health summary query returns results for any 7-, 14-, or 30-day window in under 2 seconds.

### AC-6 · Sentry
- [ ] A new Sentry issue triggers an `ObservabilityAlert` within 30 seconds of the webhook dispatch.
- [ ] When auto-create-issue is enabled, a linked Jira/Linear issue is created within 60 seconds of the alert.
- [ ] Sentry `release` tag matches a `PipelineRun` commit SHA in at least 90% of cases when the release naming convention is documented and followed.

### AC-7 · Datadog
- [ ] A Datadog monitor state change (triggered → recovered) is reflected in platform alert state within 30 seconds.
- [ ] Alert routing rules correctly direct a `severity:critical` alert to the configured Slack channel in 100% of test cases.
- [ ] Datadog Deployment Events ingested within the same time window as a metric anomaly are surfaced as correlated records on the `ObservabilityAlert`.

### AC-8 · Cross-Integration (Canonical Behavior)
- [ ] All six integration connections can be viewed, tested, and revoked from a single Integrations settings page.
- [ ] Revoking any integration token immediately halts all outbound API calls and webhook processing for that integration.
- [ ] Every integration emits structured logs with `integration`, `event_type`, `tenant_id`, and `latency_ms` fields for every inbound and outbound operation.
- [ ] No integration stores raw OAuth tokens in application logs or unencrypted at rest.

---

## Out of Scope

- **GitLab, Bitbucket, Azure DevOps** — version control alternatives deferred to v2.
- **Jira Data Center / Server** — only Jira Cloud is supported in v1.
- **PagerDuty, Opsgenie, FireHydrant** — incident management platforms deferred to v2.
- **CircleCI, Jenkins, Buildkite, ArgoCD** — alternative CI/CD systems deferred to v2.
- **New Relic, Honeycomb, Grafana** — alternative observability tools deferred to v2.
- **Asana, Notion, Shortcut** — alternative project trackers out of scope.
- **Microsoft Teams** — communication alternative deferred to v2.
- **Bi-directional real-time field sync** (e.g., keeping every Jira custom field mirrored in Linear) — the platform normalizes a defined field subset only.
- **Building or hosting a Datadog or Sentry Agent** — the platform consumes their existing APIs and webhooks; it does not replace their data-collection infrastructure.
- **End-user SSO / identity federation** across integrated tools — user identity mapping is best-effort via email address matching only in v1.