---
title: Your audit trail can finally leave the platform
date: 2026-11-15
description: Agent-run spans went to your collector but your audit trail could not. Any OpenTelemetry exporter now also ships sign-ins, role and membership changes, API keys, exports, integrations, approvals and agent tool calls as OTLP logs to your SIEM — at-least-once, with the event id as the dedup key, off the request path, and tenant-scoped by construction.
tags: [observability, security, audit, enterprise, product]
author: Sean Hogg
---

# Your audit trail can finally leave the platform

Agent-run spans already went to your own OpenTelemetry collector — Honeycomb, Datadog, Grafana, whatever you run. Your audit trail could not. Sign-ins, role changes, API keys, approval decisions, agent tool calls: all recorded, none of it exportable. A security team with a SIEM saw agent work as an island and the audit trail as a second island.

Now both islands connect. Any OpenTelemetry exporter can also ship audit events as OTLP logs to your collector's `/v1/logs` endpoint.

## Pick your signals

An exporter now says which signals it ships:

- **Traces only** — exactly what exporters did before. Nothing changes for existing rows.
- **Audit only** — the security trail goes to your SIEM; run spans stay in the product.
- **Both** — one collector, two signals. Spans post to `/v1/traces`, audit logs to `/v1/logs`.

## The event set

The sweep covers the security surface a reviewer asks about: sign-in and session events, role and membership changes, API key changes, exports, integration connections, approval decisions, and agent tool calls.

Two properties matter more than the list itself. Delivery is at-least-once with each event's id as the dedup key, and a per-source cursor means a failed batch retries from exactly where it stopped — no loss, no duplicates. And a collector outage never slows a request: the sweep runs on a background schedule, and the moment a collector starts failing, the exporter row in Settings says so, on the same health line that already showed span delivery.

## The scope line

Tenant export carries only that tenant's events. The operator trail — the cross-tenant `admin_audit_log` — is never exported to a tenant. Your SIEM sees your workspace, not anyone else's.

Set it up in **Settings → Integrations → OpenTelemetry export**.
