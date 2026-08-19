# Creation outcome metrics

## Purpose

Builderforce measures whether one Creation Session moved a user from an idea to a **graded proof** — a Build whose kill condition was measured, not merely a deliverable that was produced. Runtime activity is useful diagnostic evidence, but it is not value by itself, and a deliverable nobody graded is a launch with extra steps.

The same outcome ledger serves three consumers:

1. The session scorecard opened from the outcome icon: this session versus an aggregated tenant baseline.
2. Project and tenant value reviews: outcomes, speed, quality, reuse, intervention, cost, and latency.
3. A privacy-safe sales deck: platform-level value generation without tenant content or identifying session data.

## Where the definitions live

Every metric is declared exactly once, in `api/src/application/outcomes/outcomeMetricContract.ts`. A metric carries both halves of its own definition — the **session** value (TypeScript, from the shared fact row) and the **aggregate** value (a SQL expression over the same facts) — so the session scorecard and every rollup compute the same number from the same rows. The single write path into the ledger is `api/src/application/outcomes/outcomeLedger.ts`; the presentation contract (labels, units, comparison arithmetic) is `frontend/src/lib/outcomeMetrics.ts`, shared by both the in-canvas scorecard and the superadmin Value outcomes panel.

`OUTCOME_DEFINITION_VERSION` rides every payload, so a deck states which definition set produced the figure it quotes.

## Correlation contract

Every meaningful action emits a `started` event and exactly one terminal event with the same `correlationId` and `action`. Terminal phases are `succeeded`, `failed`, `validated`, or `reused`.

Each event carries:

- scope: `sessionId`, `projectId` when applicable, and server-derived `tenantId`;
- actor: user, agent, Brain, or system;
- action and phase;
- optional artifact ID, metric key/value/unit, duration, cost, and non-sensitive metadata;
- occurrence time.

The API derives tenant and user identity rather than trusting client-supplied scope. Named agent/Brain actors are accepted only from session roles allowed to perform the action. A project ID is accepted only when it is linked to the session; a session ID supplied by a producer outside the canvas is accepted only when `resolveOutcomeSession` proves it is a live board in the caller's tenant that the caller belongs to. The unique `(session, correlation, action, phase)` key makes retries idempotent.

`correlation_coverage = terminal events with a matching started event / terminal events` is itself a first-class quality metric. A feature is not considered fully instrumented while this falls below 100% for its meaningful actions.

### The proof lifecycle in the ledger

The method — Read → Prove → Build → Measure — records itself through `api/src/application/realization/proofOutcomes.ts`:

| Action | Emitted by | Meaning |
|---|---|---|
| `idea.read` | `POST /api/realizations/plan` | The idea was read into a spec and the proof forms were ranked. Nothing else is persisted by that call. |
| `proof.choose` | `POST /api/realizations` | A proof form was chosen. Carries the target's effort and fidelity. |
| `proof.build` | `POST /api/realizations/:id/build` | The proof was built. `succeeded` carries `metadata.reachable` when it published an address a person can open. |
| `proof.grade` | build success (`started`), verdict rollup (`validated`), park (`failed`) | The kill condition was measured. `metricValue` is 1 for met and 0 for missed — both are grades. Abandoning terminates as `failed`, because parking an idea is a judgement, not a measurement. |

A proof records nothing when it has no `realizations.session_id`: the ledger's grain is the session, and a proof started outside a board never entered that grain. Measurement is best-effort and can never fail a build; a lost write shows up honestly as `correlationCoverage` below 100%.

## Metric definitions

The north-star metric is **ideas reaching a graded proof**. Metrics are grouped by the act of the method they measure, and every surface renders them in this order.

| Metric | Family | Session value | Aggregate value | Direction |
|---|---|---:|---:|---|
| **Ideas reaching a graded proof** (north star) | Measure | 0 or 1 | sessions with a graded proof / eligible sessions | Higher |
| Time to a chosen proof form | Read → Prove | first `proof.choose` − first prompt | mean seconds | Lower |
| Ideas that Read before they Build | Read → Prove | 0 or 1, only once a build started | read-first builders / builders | Higher |
| Time to first meaningful artifact | Read → Prove | first non-chat artifact − first prompt | mean seconds | Lower |
| Proofs reaching a real, reachable artifact | Build | reachable builds / build attempts | same ratio over cohort | Higher |
| Sessions reaching a real deliverable | Build | 0 or 1 | delivered sessions / eligible sessions | Higher |
| Artifact validation pass rate | Build | passed validations / validations | same ratio over cohort | Higher |
| Delivery success rate | Build | successful deliveries / attempts | same ratio over cohort | Higher |
| Delivery retry rate | Build | failed attempts followed by another attempt / attempts | same ratio over cohort | Lower |
| Proofs whose kill condition was graded | Measure | graded proofs / proofs built | same ratio over cohort | Higher |
| Sessions inviting a human or agent | Collaboration | 0 or 1 | collaborative sessions / eligible sessions | Higher |
| Agent group-chat participation | Collaboration | distinct contributing agents | mean and distribution | Higher, with quality guardrail |
| Successful synthesis | Collaboration | 0 or 1 after agent turns | synthesized group sessions / group sessions | Higher |
| Sessions resumed in 7/30 days | Compounding value | 0 or 1 for each window | resumed sessions / eligible sessions | Higher |
| Outputs reused as inputs | Compounding value | reuse events | sum and per-session mean | Higher |
| Human intervention per delivery | Efficiency | intervention events / successful deliveries | same ratio over cohort | Lower, with safety guardrails |
| Cost per delivered outcome | Efficiency | attributed cost / successful deliveries | same ratio over cohort | Lower |
| Latency per delivered outcome | Efficiency | outcome duration | mean seconds | Lower |
| Correlation coverage | Measurement integrity | matched terminal events / terminal events | same ratio over cohort | Higher; target 100% |

“Real deliverable” requires a successful canonical delivery action such as publish, project handoff, or workflow execution. Creating a draft canvas object does not qualify. “Successful synthesis” requires an explicit Brain synthesis after participating agent turns; agent message volume alone does not qualify. “Graded” requires a measured verdict — met **or** missed; a proof that was abandoned was not graded, and the artifact validation pass rate deliberately excludes proof grading, because a missed kill condition is a finding rather than a defect.

## Diagnostics that are not value

GitHub stars, package downloads, workflow counts, MCP connections, and active-agent counts remain operational or acquisition diagnostics. They are not evidence of customer value, they are absent from the metric registry, and they do not lead roadmap prioritization or any value review.

## Aggregation and sales-deck rules

- Session is the source grain. Project, tenant, and platform values are derived, never separately hand-entered.
- Project rollups include only sessions explicitly linked to that project.
- Tenant comparisons expose aggregates, sample size, scope, and time window—not peer session titles, prompts, artifacts, or users.
- The session scorecard's baseline is a cohort aggregate over the workspace's most recently active boards (`OUTCOME_BASELINE_COHORT`), computed with the same expressions the rollups use, and excludes the session being scored.
- Platform sales-deck figures use minimum cohort thresholds, suppress small segments, and include denominator, time window, and data freshness.
- Cost and latency remain `Not measured` until authoritative telemetry is attached. The UI never substitutes zero for missing data.
- Historical definitions are versioned. A deck states the definition version so a changing qualification rule cannot silently rewrite prior claims.

## Instrumentation rollout

The outcome ledger and scorecard are the foundation. Session open, prompt evaluation, validation, delivery, output reuse, and the full proof lifecycle (read, choose, build, grade) are correlated actions today. The superadmin Value outcomes dashboard supplies platform, tenant, and project cohorts; equal-period comparisons; trends including graded proofs; and a content-free sales brief guarded by a ten-session external-use threshold and stamped with its definition version. Remaining Creation Canvas actions must migrate to the same contract, and correlation coverage provides the completion test. A rendered presentation export remains follow-up work.
