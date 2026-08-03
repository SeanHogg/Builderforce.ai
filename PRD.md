> **PRD** — drafted by Ada (Sr. Product Mgr) · task #650
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Project Health Diagnostic Report Service

## Problem & Goal
Stakeholders and project managers lack a single, structured, and programmatically accessible snapshot of project health across six critical dimensions. Manual check-ins and scattered dashboards lead to inconsistent visibility, delayed risk identification, and misalignment. The goal is to provide a backend service that generates a comprehensive, machine-readable diagnostic report with health scores and trend indicators, enabling automated reporting, integration into monitoring pipelines, and consistent health evaluation.

## Target Users / ICP Roles
- **Engineering Managers & Tech Leads**: Consume health data to prioritize mitigations.
- **Program & Delivery Managers**: Rely on structured reports for status updates.
- **Downstream Automation Services**: Orchestration engines or CI/CD pipelines that trigger actions based on health metrics.
- **Internal Analytics Dashboards**: Display historical health trends aggregated from generated reports.

## Scope
Deliver a single TypeScript service file (`diagnosticReport.ts`) that exposes at least one exported class or function capable of creating a structured project health snapshot. The output includes typed sections for Timeline, Budget, Quality, Risk, Team, and Alignment, each containing a numeric health score (0–100), a trend indicator, and a short summary.

### In Scope
- Single file implementation with clear public API surface.
- Strictly-typed diagnostic report generation function/class.
- Six mandatory report sections.
- Trend indicator logic (improving, stable, declining) per section.
- Unit-test-friendly structure (pure functions where feasible, minimal side effects).

### Out of Scope
- Persistent storage or database integration.
- Real-time data ingestion from external APIs or systems.
- Authentication, authorization, or request throttling.
- Visualization or UI rendering of the report.
- Historical report versioning or comparison logic.
- Alerting or notification dispatch.

## Functional Requirements

### FR1: Report Generation Entry Point
The module must export at least one named entity (function or class) that, when invoked with required input parameters, returns a complete `DiagnosticReport` object.

### FR2: DiagnosticReport Schema
The generated report must conform to the following structure:

```
DiagnosticReport {
  generatedAt: ISO-8601 string;
  projectId: string;
  sections: {
    timeline: Section;
    budget: Section;
    quality: Section;
    risk: Section;
    team: Section;
    alignment: Section;
  };
}
```

Where each `Section` contains:
- `score`: number (integer, 0–100)
- `trend`: "improving" | "stable" | "declining"
- `summary`: string (1–3 sentence natural-language summary)

### FR3: Input Parameters
The service must accept a typed input object containing at minimum:
- `projectId: string`
- `metrics`: An object with fields representing raw data points for each section (e.g., schedule variance, budget burn rate, defect density, risk count, team velocity, stakeholder alignment percentage). The exact shape is at the discretion of the implementation but must be strictly typed and documented.

### FR4: Scoring Normalization
Each section score must be normalized to a 0–100 scale based on the provided input metrics. The normalization algorithm must be deterministic and testable.

### FR5: Trend Computation
The service must compute trend based on either:
- A comparison between current metrics and optional `previousMetrics` provided in the input, OR
- A threshold-based heuristic defined per section type if no previous data is supplied.

If previous data is unavailable, trend defaults to `"stable"` with a clear indication in the summary.

### FR6: Summary Generation
Each section summary must be a human-readable string dynamically composed from the score, trend, and key metric highlights. No hardcoded generic text; summaries must reflect input data.

### FR7: Input Validation
The service must validate the input object and throw a descriptive error if required fields are missing or malformed (e.g., scores out of range, negative values where inappropriate).

## Acceptance Criteria
- Export `generateDiagnosticReport` (function) or `DiagnosticReportGenerator` (class) from `diagnosticReport.ts`.
- Calling the exported entity with a valid `DiagnosticInput` returns a `DiagnosticReport` object matching the schema.
- All six sections are present and contain valid scores (0–100), recognized trends, and non-empty summaries.
- Providing identical inputs yields identical outputs (pure function behavior).
- When `previousMetrics` is supplied, trend computation reflects directional change (e.g., declining if quality score dropped).
- Invalid inputs (missing projectId, out-of-range metrics) cause thrown errors with clear messages.
- Output JSON-serializable, containing no circular references or runtime-specific artifacts.
- Implementation passes linting, type checks, and does not rely on runtime environment globals (except standard library).

## Requirements

_Owned by the business-analyst — authored by the BA role on task #650._

### RQ1: Module & Export Shape
- The module SHALL reside at `api/src/application/diagnostics/diagnosticReport.ts`.
- It MUST export a named function `generateDiagnosticReport`.
- All types (interfaces) used in the public API (`DiagnosticInput`, `DiagnosticReport`, `DiagnosticMetrics`, `Section`, `Trend`) MUST also be exported so consumers can type their call sites.

### RQ2: Input Contract (`DiagnosticInput`)
- `projectId` (string, required, non-empty).
- `metrics` (object, required) — a `DiagnosticMetrics` bag where every sub-field is optional. Consumers supply only the data they have.
- `previousMetrics` (object, optional) — same shape as `metrics`. When present, trend is derived by comparing each section's current score against the previous score.

### RQ3: Output Contract (`DiagnosticReport`)
- The returned object MUST contain:
  - `generatedAt`: ISO‑8601 timestamp string.
  - `projectId`: echo of the input.
  - `sections`: an object with exactly six keys — `timeline`, `budget`, `quality`, `risk`, `team`, `alignment`.
- Each section value MUST be a `Section` with:
  - `score`: integer 0–100.
  - `trend`: `"improving"` | `"stable"` | `"declining"`.
  - `summary`: a non‑empty, human‑readable string (1‑3 sentences).

### RQ4: Scoring Algorithm (per dimension)
| Dimension  | Primary inputs                                          | Algorithm summary |
|------------|--------------------------------------------------------|-------------------|
| Timeline   | `completionPct`, `elapsedDays`, `plannedDurationDays`   | Schedule Performance Index (SPI = completion% ÷ elapsed%); linear score clamped to [0,100]. |
| Budget     | `totalBudget`, `spentToDate`, `completionPct`           | Cost Performance Index (CPI = progress% ÷ spent%); linear score clamped to [0,100]. Falls back to burn-rate heuristic when totalBudget is absent. |
| Quality    | `defectDensity`, `openDefects`, `changeFailureRatePct`, `mttrHours`, `testCoveragePct` | Weighted average of inverted / direct metrics; all sub-components clamped to [0,100]. |
| Risk       | `aggregateRiskScore`, `riskCount`, `highSeverityRiskCount`, `mitigatedRiskCount` | Prefers aggregate score if supplied; otherwise derives from high-severity ratio and mitigation coverage. |
| Team       | `velocity`, `targetVelocity`, `activeContributors`, `openRoles`, `churnRatePct` | Velocity ratio double-weighted; penalised by unfilled roles and churn. All clamped to [0,100]. |
| Alignment  | `stakeholderAlignmentPct`, `okrLinkedPct`, `scopeChangeCount`, `acceptedScopeChanges` | Weighted average of direct percentages; scope‑churn penalty applied when acceptance rate is low. |

- When a section has NO relevant data, its score MUST be `0` and its summary MUST indicate "no data available".
- All scoring functions MUST be deterministic and free of side effects.

### RQ5: Trend Derivation
- When `previousMetrics` is provided: compare each section's current score to its previous score.
  - Δ > +5 → `"improving"`
  - Δ < −5 → `"declining"`
  - Otherwise → `"stable"`
- When `previousMetrics` is absent: apply an absolute-score heuristic:
  - Score ≥ 70 → `"improving"`
  - Score ≤ 40 → `"declining"`
  - Otherwise → `"stable"`
  - The summary MUST note that no previous data was available for comparison.

### RQ6: Summary Generation
- Every section summary MUST be constructed dynamically from the input metric values — no hard‑coded, generic strings.
- Each summary MUST include: the key metric highlights for that dimension, the trend label, and the numeric score.

### RQ7: Input Validation
- Missing or empty `projectId` → thrown `Error` with descriptive message.
- `metrics` absent or not an object → thrown `Error`.
- Any supplied numeric metric outside its documented range (e.g. percentages not in [0,100], fractions not in [0,1], negative counts) → thrown `Error`.
- The validation error type is `ValidationError` extending `Error` (name `"ValidationError"`).

### RQ8: Non‑Functional
- Pure function — identical inputs produce identical outputs.
- No network, file‑system, or database access.
- No runtime globals beyond `Date` and standard library.
- JSON‑serializable output (no circular references).

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._