# Canonical Integration Set

**Seed:** task #310 | **Status:** Draft | **Version:** 1.0.0

## Purpose

Jira, Linear, GitHub, Slack, GitHub Actions, Sentry, and Datadog are the six integrations required at launch. This document establishes clear contracts and a single source of truth (known as the **canonical integration set**) so that downstream agents (implementation, QA, docs) operate from a unified view.

## In-Scope (v1)

| Category | Tool(s) | Status |
|----------|---------|--------|
| Project Tracking | Jira Cloud, Linear | Out-of-Scope alternatives: Asana, Notion, Shortcut |
| Version Control | GitHub | Out-of-Scope alternatives: GitLab, Bitbucket, Azure DevOps |
| Communication | Slack | Alternative out-of-scope: Microsoft Teams |
| CI/CD | GitHub Actions | Out-of-Scope alternatives: CircleCI, Jenkins, Buildkite, ArgoCD |
| Observability — Error Tracking | Sentry | Alternative out-of-scope: New Relic, Honeycomb, Grafana |
| Observability — Metrics & APM | Datadog | Uses Datadog Events API for deployment correlation |

## Shared Mechanisms

### Canonical Event Schemas

All integrations must emit structured events that inherit from these platform-wide schemas:

- **`Issue`** — project-tracking events from Jira and Linear.
- **`ChangeSet`** — repository-level change events from GitHub.
- **`PipelineRun`** — GitHub Actions workflow/run events.
- **`ObservabilityAlert`** — error and monitor alerts from Sentry and Datadog.
- **`Message`** — outbound messages from Slack.

These schemas live in `/integrations/Schemas/*.ts` and are versioned.

### Canonical Behavior

Every integration in the set MUST observe these cross-cutting rules:

- **Logging:** Structured logs with `integration`, `event_type`, `tenant_id`, `latency_ms` for every inbound and outbound operation.
- **Token Storage:** No raw OAuth tokens in application logs or unencrypted at rest. Tokens reside in the integrations config store.
- **Deactivation:** Revoking any integration token immediately halts all outbound API calls and webhook processing for that integration.
- **Identity:** End-user SSO / identity federation is **not supported** in v1; user identity mapping is best-effort via email address matching only.

## Directory Structure

```
/
├── integrations/
│   ├── README.md                           # This file
│   ├── INTEGRATIONS_REGISTRY.json          # Machine-readable contract registry
│   └── Schemas/
│       ├── index.ts                        # Shared exports
│       ├── Issue.ts                        # Issue event (Jira, Linear)
│       ├── ChangeSet.ts                    # ChangeSet event (GitHub)
│       ├── PipelineRun.ts                  # PipelineRun event (GitHub Actions)
│       └── ObservabilityAlert.ts           # ObservabilityAlert event (Sentry, Datadog)
```

## Implementing a Valid Integration

To implement a new integration that respects the canonical set:

1. **Register in `INTEGRATIONS_REGISTRY.json`.** Add an entry under `canonicalIntegrationSet.integrations` with:
   - `category` matching one of the six categories.
   - `id`, `displayName`, `description`.
   - `auth` method, endpoints, and webhook payloads.
   - Reference to events-to-emit (inheriting the shared schemas).
   - Any integration-specific constraints.

2. **Emit Canonical Events.** Ensure the integration produces events that match the corresponding schema:
   - Jira and Linear → `Issue` events.
   - GitHub → `ChangeSet` events.
   - GitHub Actions → `PipelineRun` events.
   - Sentry and Datadog → `ObservabilityAlert` events.

3. **Observe Canonical Behavior.** Implement token storage, deactivation hooks, and structured logging as per the canonical behavior rules.

## Out of Scope

The following tools are excluded from v1 to focus on a minimal yet complete common surface:

- **Version Control Alternatives:** GitLab, Bitbucket, Azure DevOps.
- **Project Trackers:** Asana, Notion, Shortcut.
- **Communication Alternatives:** Microsoft Teams.
- **CI/CD Alternatives:** CircleCI, Jenkins, Buildkite, ArgoCD.
- **Observability Alternatives:** New Relic, Honeycomb, Grafana.
- **Incident Management:** PagerDuty, Opsgenie, FireHydrant.
- **Deployment Agents:** Building or hosting Datadog/Sentry agents; the platform consumes their APIs and webhooks.
- **Bi-directional Field Sync:** Complete feature parity between Jira and Linear is out of scope; normalization of a defined subset only.
- **SSO / Identity Federation across integrated tools:** v1 supports only email-match best-effort identity mapping.

## Acceptance Criteria Summary

- **Jira & Linear:** OAuth flow <60s, issue latency <5s (Jira), internal state <10s, schema compatibility.
- **GitHub:** App install without manual steps, PR pattern `<issue-id>-*` auto-linking, `ChangeSet` event in <15s.
- **Slack:** Bot message <5s, handler <10s, disconnect immediate.
- **GitHub Actions:** `PipelineRun` event in <30s, log URL on failure, health summary query <2s.
- **Sentry:** `ObservabilityAlert` in <30s, auto-create linked issue <60s, release SHA match ≥90%.
- **Datadog:** monitor state <30s, critical alert routing 100% correct, deployment correlation.

## References

- PRD: [PRD.md](../PRD.md) (task #310 contains full spec).
- Architecture: [Agent Runtime Architecture](../agent-runtime/docs/ARCHITECTURE.md).
- Schema Registry Key: `$SCHEMA_*` in TypeScript files in `/integrations/Schemas`.