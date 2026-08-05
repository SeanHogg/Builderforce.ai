# Creation outcome metrics

## Purpose

Builderforce measures whether one Creation Session moved a user from an idea to a validated, delivered outcome. Runtime activity is useful diagnostic evidence, but it is not value by itself.

The same outcome ledger serves three consumers:

1. The session scorecard opened from the outcome icon: this session versus an aggregated tenant baseline.
2. Project and tenant value reviews: outcomes, speed, quality, reuse, intervention, cost, and latency.
3. A privacy-safe sales deck: platform-level value generation without tenant content or identifying session data.

## Correlation contract

Every meaningful action emits a `started` event and exactly one terminal event with the same `correlationId` and `action`. Terminal phases are `succeeded`, `failed`, `validated`, or `reused`.

Each event carries:

- scope: `sessionId`, `projectId` when applicable, and server-derived `tenantId`;
- actor: user, agent, Brain, or system;
- action and phase;
- optional artifact ID, metric key/value/unit, duration, cost, and non-sensitive metadata;
- occurrence time.

The API derives tenant and user identity rather than trusting client-supplied scope. Named agent/Brain actors are accepted only from session roles allowed to perform the action. A project ID is accepted only when it is linked to the session. The unique `(session, correlation, action, phase)` key makes retries idempotent.

`correlation_coverage = terminal events with a matching started event / terminal events` is itself a first-class quality metric. A feature is not considered fully instrumented while this falls below 100% for its meaningful actions.

## Metric definitions

| Metric | Session value | Aggregate value | Direction |
|---|---:|---:|---|
| Time to first meaningful artifact | first non-chat artifact time − first prompt time | median/mean seconds | Lower |
| Sessions reaching a real deliverable | 0 or 1 | delivered sessions / eligible sessions | Higher |
| Sessions inviting a human or agent | 0 or 1 | collaborative sessions / eligible sessions | Higher |
| Agent group-chat participation | distinct contributing agents | mean and distribution | Higher, with quality guardrail |
| Successful synthesis | 0 or 1 after agent turns | synthesized group sessions / group sessions | Higher |
| Artifact validation/pass rate | passed validations / validations | same ratio over cohort | Higher |
| Delivery success rate | successful deliveries / attempts | same ratio over cohort | Higher |
| Delivery retry rate | failed attempts followed by another attempt / attempts | same ratio over cohort | Lower |
| Session resumed in 7/30 days | 0 or 1 for each window | resumed sessions / eligible sessions | Higher |
| Outputs reused as inputs | reuse events | sum and per-session mean | Higher |
| Human intervention per delivery | intervention events / successful deliveries | same ratio over cohort | Lower, with safety guardrails |
| Cost per delivered outcome | attributed cost / successful deliveries | same ratio over cohort | Lower |
| Latency per delivered outcome | outcome duration | median and p95 | Lower |
| Correlation coverage | matched terminal events / terminal events | same ratio over cohort | Higher; target 100% |

“Real deliverable” requires a successful canonical delivery action such as publish, project handoff, or workflow execution. Creating a draft canvas object does not qualify. “Successful synthesis” requires an explicit Brain synthesis after participating agent turns; agent message volume alone does not qualify.

## Aggregation and sales-deck rules

- Session is the source grain. Project, tenant, and platform values are derived, never separately hand-entered.
- Project rollups include only sessions explicitly linked to that project.
- Tenant comparisons expose aggregates, sample size, scope, and time window—not peer session titles, prompts, artifacts, or users.
- Platform sales-deck figures use minimum cohort thresholds, suppress small segments, and include denominator, time window, and data freshness.
- Cost and latency remain `Not measured` until authoritative telemetry is attached. The UI never substitutes zero for missing data.
- Historical definitions are versioned. A deck states the definition version so a changing qualification rule cannot silently rewrite prior claims.

## Instrumentation rollout

The outcome ledger and scorecard are the foundation. Session open, prompt evaluation, validation, delivery, and output reuse are the first correlated actions. The superadmin Value outcomes dashboard now supplies platform, tenant, and project cohorts; equal-period comparisons; trends; and a content-free sales brief guarded by a ten-session external-use threshold. Remaining Creation Canvas actions must migrate to the same contract, and correlation coverage provides the completion test. Versioned metric definitions and a rendered presentation export remain follow-up work.
