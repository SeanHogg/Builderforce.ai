> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #325
> _Each agent that updates this PRD signs its change below._

# PRD: Version Control System (VCS) Integration Health & Ingestion Verification

## Problem & Goal

Engineering teams and platform administrators lack a reliable, at-a-glance way to verify whether their Version Control System integrations (GitHub, GitLab, Bitbucket) are correctly connected, have the expected repositories linked, and are actively ingesting commits and pull/merge requests. Silent failures — expired tokens, missed webhooks, or stalled ingestion pipelines — go undetected until downstream features (code search, PR analytics, audit trails) break. The goal is to provide a deterministic, automated verification layer that surfaces the real-time health of every VCS integration and its ingestion state.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Platform / DevOps Engineer** | Confirm integrations are wired correctly post-setup or post-rotation of credentials |
| **Engineering Manager** | Validate that all team repos are linked and contributing data to analytics |
| **Security / Compliance Officer** | Audit that no authorised repos are missing from ingestion trails |
| **Internal Support / SRE** | Diagnose integration failures quickly without direct DB or queue access |

---

## Scope

This PRD covers the **verification and observability layer** for VCS integrations. It does not redesign the underlying connectors or ingestion pipelines themselves, only the checks, status surfaces, and alerting that confirm they are operating correctly.

Supported providers in scope:
- GitHub (GitHub.com and GitHub Enterprise Server)
- GitLab (GitLab.com and self-managed)
- Bitbucket (Bitbucket Cloud and Bitbucket Data Center)

---

## Functional Requirements

### FR-1 Connection Health Check

1. **FR-1.1** The system must perform a live authentication probe against each configured VCS provider using the stored credential (OAuth token, PAT, or App installation token) and report `CONNECTED`, `AUTH_FAILED`, or `UNREACHABLE`.
2. **FR-1.2** The probe must record the HTTP status code, error message, and UTC timestamp of the last successful and last failed attempt.
3. **FR-1.3** Token expiry must be detected and flagged with the expiry date at least 7 days before expiration.
4. **FR-1.4** Connection probes must run on a configurable schedule (default: every 15 minutes) and be triggerable on demand via API.

### FR-2 Repository Linkage Verification

1. **FR-2.1** For each VCS integration, the system must enumerate all repositories that are expected to be linked (based on org/group scope or explicit allow-list).
2. **FR-2.2** The system must compare expected repos against actively linked repos and surface any `MISSING`, `ADDED`, or `PERMISSION_DENIED` deltas.
3. **FR-2.3** Each linked repository must display: provider, full path/slug, visibility (public/private), default branch, and linkage status.
4. **FR-2.4** Repository access permission changes (e.g., repo made private, App installation revoked) must be detected within one scheduled probe cycle.

### FR-3 Commit Ingestion Verification

1. **FR-3.1** The system must track, per repository, the timestamp and SHA of the last successfully ingested commit.
2. **FR-3.2** A repository is flagged `INGESTION_STALE` if no new commit has been ingested within a configurable window (default: 24 hours) when the provider reports commits newer than the last ingested SHA.
3. **FR-3.3** The system must record ingestion lag (time delta between commit push timestamp and ingestion timestamp) as a metric.
4. **FR-3.4** Ingestion error events (webhook failures, parsing errors, queue drops) must be logged with error type, affected repo, and affected commit SHA.

### FR-4 Pull / Merge Request Ingestion Verification

1. **FR-4.1** The system must track, per repository, the ID and updated-at timestamp of the last successfully ingested PR/MR.
2. **FR-4.2** A repository is flagged `PR_INGESTION_STALE` if open or recently closed PRs/MRs on the provider are not reflected in the internal store within the configurable staleness window (default: 1 hour).
3. **FR-4.3** Webhook delivery failures for PR/MR events must be detected by comparing webhook delivery logs from the provider API against internal receipt records.
4. **FR-4.4** The system must support backfill detection: identify PRs/MRs that exist on the provider but are absent from the internal store and queue them for re-ingestion.

### FR-5 Status Dashboard & API

1. **FR-5.1** A summary dashboard view must display one status card per VCS integration showing: provider type, connection status, repo count (linked / expected), last commit ingested (time ago), last PR/MR ingested (time ago), and any active alerts.
2. **FR-5.2** A drill-down view per integration must list all linked repos with their individual ingestion health.
3. **FR-5.3** All health data must be queryable via a REST API (`GET /integrations/vcs/{id}/health`) returning a structured JSON payload.
4. **FR-5.4** The API must return HTTP 200 with health payload for healthy integrations and HTTP 200 with a degraded/error status field (not HTTP 5xx) so callers can parse state programmatically.

### FR-6 Alerting & Notifications

1. **FR-6.1** Alerts must fire for: `AUTH_FAILED`, `INGESTION_STALE`, `PR_INGESTION_STALE`, `REPO_MISSING`, and `TOKEN_EXPIRY_SOON`.
2. **FR-6.2** Alert delivery channels must include: in-app notification, email, and webhook (to support Slack/PagerDuty routing).
3. **FR-6.3** Alert deduplication must prevent repeat notifications for the same unresolved condition within a configurable quiet period (default: 4 hours).
4. **FR-6.4** Alerts must auto-resolve and send a resolution notification when the condition clears on the next successful probe.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a valid OAuth token, when a connection probe runs, then the integration status returns `CONNECTED` within 30 seconds. |
| AC-2 | Given a revoked or expired token, when a probe runs, then status returns `AUTH_FAILED` with the HTTP error code and an alert fires within one probe cycle. |
| AC-3 | Given a repo is removed from the VCS org, when the next probe completes, then the repo appears as `MISSING` in the linkage diff and an alert is raised. |
| AC-4 | Given a commit is pushed to a linked repo, when more than 24 hours pass without that commit appearing in the internal store, then the repo is marked `INGESTION_STALE`. |
| AC-5 | Given a PR is opened on a linked repo, when more than 1 hour passes without that PR appearing in the internal store, then the repo is marked `PR_INGESTION_STALE`. |
| AC-6 | Given a webhook delivery failure is recorded by the provider, when the system polls provider webhook logs, then the failure is detected and logged within the next probe cycle. |
| AC-7 | Given an integration is healthy, when `GET /integrations/vcs/{id}/health` is called, then it returns HTTP 200 with `status: "healthy"` and populated last-ingested timestamps for commits and PRs. |
| AC-8 | Given a `TOKEN_EXPIRY_SOON` condition, when the token expires in ≤ 7 days, then an alert is sent via all configured channels and is not re-sent for 4 hours. |
| AC-9 | Given an alert condition clears, when the next probe succeeds, then a resolution notification is delivered and the alert is marked resolved in the dashboard. |
| AC-10 | All health probes complete within 60 seconds per integration under normal provider API response times. |

---

## Out of Scope

- Redesign or re-implementation of the underlying VCS connector or ingestion pipeline logic.
- Code diff parsing, blame, or any semantic analysis of ingested commits.
- Support for VCS providers not listed (e.g., Azure DevOps, Perforce, SVN) — covered by a separate PRD.
- Fine-grained per-file or per-branch ingestion tracking.
- User-facing OAuth consent flows or credential rotation UI (credential management is owned by the Auth & Integrations team).
- SLA enforcement or billing impacts based on ingestion lag.
- Historical trend analytics on ingestion performance beyond a 30-day rolling window.