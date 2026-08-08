> **PRD** — drafted by Ada (Sr. Product Mgr) · task #557
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Integration Health Endpoint & Configurable Polling/Alerts

## Problem & Goal
**Problem:** System operators lack a single, programmatic endpoint to understand the connectedness and status of all configured integrations. Failures are not detected fast enough or signaled with sufficient severity for timely response, and there is no unified dashboard view of integration health.

**Goal:** Deliver an integration health/status endpoint, configurable periodic health checks, and an alerting mechanism that escalates persistent failures so operators can detect and respond to degraded integrations quickly.

## Target Users / ICP Roles
- **Platform SRE / DevOps Engineers** – monitoring system dashboards and configuring alert thresholds.
- **Integration administrators** – verifying integration connectivity during setup or troubleshooting.
- **Support engineers** – triaging connectivity-related tickets using health status.

## Scope
- Health endpoint serving a structured status per integration.
- Health checks run at startup and on a configurable interval.
- Alert emission after configurable consecutive failure count.
- Aggregation of integration health in the system health dashboard.

## Functional Requirements

### FR-1: Health/Status Endpoint
1. Expose `GET /api/system/integrations/health` returning JSON array of integration status objects.
2. Each object includes: `integrationId`, `displayName`, `status` (enum: `connected`, `degraded`, `disconnected`), `lastCheckedTimestamp` (ISO-8601), and optional `failureReason`.
3. Endpoint must respond within 300 ms under normal load (p95).
4. Authentication required (same auth mechanism as other internal APIs).

### FR-2: Health Check Execution
1. On application startup, trigger an initial health check for every configured integration.
2. After startup, run health checks at a configurable interval. Default: 60 seconds.
3. Support configuration via environment variable or config file key: `INTEGRATION_HEALTH_CHECK_INTERVAL_SECONDS`.
4. For each check, verify integration connectivity (e.g., API key validity, endpoint reachability, successful ping/poll). Degraded is allowed where connectivity is partial or latency exceeds a defined timeout threshold.

### FR-3: Failure Threshold & Alerts
1. Track consecutive failure count per integration.
2. When an integration reaches configurable `CRITICAL_FAILURE_COUNT` (default: 3), emit a `CRITICAL` health event.
3. Health event includes: `integrationId`, `status`, `failureCount`, `firstFailureTimestamp`, `lastFailureTimestamp`.
4. Once the integration returns to `connected`, reset the failure count and emit a `RECOVERY` event.
5. Configuration key: `INTEGRATION_HEALTH_CRITICAL_FAILURE_COUNT`.

### FR-4: System Health Dashboard
1. Add a “Integration Health” section to the existing system health dashboard UI.
2. Display a summary row: counts of connected, degraded, disconnected integrations.
3. Show a filterable table/grid listing each integration with status icon, name, last checked time, and failure count.
4. Auto-refresh dashboard data every 30 seconds (or matching smallest polling interval).

## Acceptance Criteria
- **AC-1:** Querying GET `/api/system/integrations/health` returns valid JSON for all integrations with correct status values when one integration is manually disconnected.
- **AC-2:** Health check runs immediately on startup and then at the configured interval (verify via timestamps in logs and endpoint response).
- **AC-3:** After disabling an integration’s network access and waiting 3 consecutive failures, a CRITICAL health event is fired and observable in the event/audit log.
- **AC-4:** On restoring connectivity, a RECOVERY event is emitted, and the failure counter resets.
- **AC-5:** System health dashboard shows the integration status block with real-time updates within one polling cycle of change.
- **AC-6:** Endpoint p95 latency ≤ 300 ms with up to 200 configured integrations.

## Out of Scope
- Automatic self-healing or integration restart logic.
- Custom per-integration health check intervals or timeout overrides.
- Predictive alerting based on health trends.
- Historical health trending charts (time-series data) in this phase.
- External notification delivery (email, Slack, PagerDuty) – only internal health event emission is included.

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._