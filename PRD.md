> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #259
> _Each agent that updates this PRD signs its change below._

# PRD: Health Assessment – Auto-Generated Health Scorecard

## Problem & Goal

Engineering and operations teams currently lack a unified, real-time view of system health. Diagnosing degradation requires manually correlating metrics across disparate dashboards, log aggregators, and alerting tools — a process that is slow, inconsistent, and error-prone. The goal is to automatically generate a structured **Health Scorecard** that aggregates signals from multiple data sources, computes a normalized health score per component and for the system as a whole, and surfaces actionable insights without requiring manual compilation.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Site Reliability Engineer (SRE) | Rapid triage and root-cause prioritization during incidents |
| Platform / DevOps Engineer | Continuous visibility into infrastructure and service health |
| Engineering Manager | Executive-level health summary for owned services |
| On-Call Responder | Single-pane-of-glass view during an active incident |

---

## Scope

### In Scope
- Automatic scorecard generation triggered on a configurable schedule and on-demand.
- Ingestion of health signals from pre-defined data sources (metrics, logs, synthetic checks, dependency statuses).
- Per-component scoring and an aggregated system-level score.
- Severity classification and trend indicators per component.
- Scorecard persistence and a queryable history.
- UI panel and machine-readable API endpoint exposing the scorecard.

### Out of Scope *(see dedicated section below)*

---

## Functional Requirements

### FR-1 — Signal Ingestion
- The system **must** collect health signals from at minimum: infrastructure metrics (CPU, memory, disk, network), application error rates, latency percentiles (p50, p95, p99), uptime/synthetic check results, and upstream/downstream dependency statuses.
- Ingestion **must** be pluggable; new signal sources can be added via a declarative configuration file without code changes.
- Each signal **must** carry a timestamp, source identifier, current value, unit, and collection status (`ok` | `stale` | `error`).

### FR-2 — Scoring Engine
- Each component receives a normalized health score on a **0–100 integer scale**.
- The scoring algorithm **must** apply configurable per-signal thresholds and weights defined in a YAML/JSON policy file.
- The system-level score **must** be a weighted aggregate of all active component scores.
- Score changes ≥ 10 points within a single evaluation cycle **must** be flagged as a significant delta.

### FR-3 — Severity Classification
- Every component score **must** map to one of four severity tiers:

  | Tier | Score Range | Label |
  |---|---|---|
  | 1 | 90–100 | Healthy |
  | 2 | 70–89 | Degraded |
  | 3 | 40–69 | At Risk |
  | 4 | 0–39 | Critical |

- The overall system severity **must** be the worst-case tier of any Critical or At Risk component.

### FR-4 — Trend Analysis
- Each component **must** display a trend indicator: `improving`, `stable`, or `degrading`, computed by comparing the current score against the rolling average of the previous 5 evaluation cycles.
- Trend calculation **must** fall back to `stable` when fewer than 2 historical data points exist.

### FR-5 — Scorecard Generation
- A full scorecard **must** be generated automatically on a configurable interval (default: every 5 minutes).
- On-demand generation **must** be available via UI button and API call.
- Each scorecard **must** contain: scorecard ID, generation timestamp, evaluation window, system-level score and severity, per-component breakdown (score, severity, trend, contributing signals, top issue), and a plain-language summary sentence.

### FR-6 — Persistence & History
- Scorecards **must** be persisted in durable storage with a minimum retention period of 90 days.
- The system **must** provide a queryable history endpoint supporting time-range filtering and component filtering.
- Historical scorecards **must** be immutable after generation.

### FR-7 — API
- A REST endpoint `GET /api/v1/health/scorecard` **must** return the latest scorecard as JSON.
- A REST endpoint `GET /api/v1/health/scorecard/{id}` **must** return a specific historical scorecard.
- A REST endpoint `POST /api/v1/health/scorecard/generate` **must** trigger an immediate on-demand evaluation.
- All endpoints **must** require authenticated requests (token-based auth).

### FR-8 — UI Panel
- A dedicated Health Scorecard panel **must** render the latest scorecard with color-coded severity, trend arrows, and component drill-down.
- The panel **must** auto-refresh at the same interval as scorecard generation.
- Clicking a component row **must** expand a detail view showing contributing signals and recommended next steps.

### FR-9 — Alerting Integration
- When the system-level severity transitions to **At Risk** or **Critical**, the system **must** emit a notification event to configured alert channels (e.g., PagerDuty, Slack webhook).
- Alert suppression **must** be supported via a configurable cool-down period (default: 15 minutes) to prevent alert storms.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given a fully instrumented environment, a scorecard is generated within 30 seconds of the scheduled interval or on-demand trigger. |
| AC-2 | All configured signal sources are reflected in the scorecard; any source with a `stale` or `error` collection status is visibly flagged in the UI. |
| AC-3 | Component scores and the system-level score are computed according to the active policy file; changing a threshold in the policy file takes effect on the next evaluation cycle without a service restart. |
| AC-4 | Severity tiers and trend indicators match the definitions in FR-3 and FR-4 for 100% of components across a suite of synthetic test inputs. |
| AC-5 | A scorecard generated 91 days ago is no longer returned by the history endpoint; one generated 89 days ago is still accessible. |
| AC-6 | `GET /api/v1/health/scorecard` returns a valid JSON response conforming to the published schema within 500 ms under normal load. |
| AC-7 | An unauthenticated request to any scorecard API endpoint returns HTTP 401. |
| AC-8 | A severity transition from Healthy → At Risk triggers a notification to all configured alert channels within 60 seconds; a second transition within the cool-down window does not generate a duplicate alert. |
| AC-9 | The UI panel renders the latest scorecard correctly in Chrome, Firefox, and Safari without layout defects. |
| AC-10 | End-to-end test: simulating a spike in error rate above threshold causes the affected component to move to At Risk within one evaluation cycle, trend to show `degrading`, and a Slack notification to be delivered. |

---

## Out of Scope

- **Automated remediation** — the scorecard surfaces insights only; automated fix actions are handled by a separate runbook-automation feature.
- **Cost/billing health signals** — financial health metrics are not included in this iteration.
- **Custom scoring algorithms per user** — policy files are global; per-user scoring customization is deferred.
- **Mobile-native UI** — only the web panel is in scope; a mobile app view is a future enhancement.
- **Machine-learning anomaly detection** — trend analysis uses statistical rolling averages only; ML-based anomaly scoring is out of scope for this release.
- **Multi-tenant scorecard isolation** — each deployment generates a single system-wide scorecard; per-tenant scoring is not addressed here.
- **Log-content parsing beyond error rates** — deep log analysis (e.g., pattern extraction) is out of scope; only aggregated error-rate counters are consumed.