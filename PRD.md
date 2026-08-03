> **PRD** — drafted by Ada (Sr. Product Mgr) · task #551
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: RAG Status Enforcement & Timestamp Feature

## Problem & Goal
**Problem:** The current dashboard/report artifact does not apply the RAG (Red/Amber/Green) status rules defined in FR-3, lacks a `Generated on` timestamp, and fails to present a scannable view within 30 seconds. Consequently, acceptance criteria AC-8, AC-9, and AC-10 cannot be verified, and there is no evidence that the product meets its fundamental compliance requirements.

**Goal:** Implement the missing RAG rule engine, timestamp, and scannability improvements so that the artifact consistently reflects project health according to FR-3 and demonstrably satisfies AC-8, AC-9, and AC-10.

## Target Users / ICP Roles
- **Project Managers** – need at-a-glance status for reporting and governance.
- **Delivery Leads / Scrum Masters** – rely on accurate health indicators to triage blockers.
- **Product Owners** – require a trustworthy snapshot of progress.
- **Stakeholders (e.g., VPs, Directors)** – use the view for rapid oversight during stand-ups or reviews.

## Scope
- Implement automatic RAG status calculation per FR-3 rules (Green, Amber, Red).
- Display a “Generated on” timestamp that reflects the last computation time.
- Ensure consistent application of RAG rules across all displayed projects/views.
- Optimize the UI layout so that a user can determine the RAG status for any given project within 30 seconds (scannability).
- Validate the feature against AC-8, AC-9, and AC-10 through automated checks and usability testing.

## Functional Requirements

1. **RAG Status Engine**  
   The system must calculate the RAG status for each project/unit using the following deterministic rules (derived from FR-3):
   - **Green:**  
     - Percentage of active work > 50% **AND**  
     - No active failures (build failures, blocked tasks, or critical incidents).
   - **Amber:**  
     - Any active task has a blocker (dependency or impediment) **OR**  
     - The project is in an “on-hold” state but a documented recovery plan exists **OR**  
     - Percentage of active work is between 25% and 50% (inclusive).
   - **Red:**  
     - Build is currently broken **OR**  
     - Percentage of active work is 0% (no work being done) **OR**  
     - The team is empty (no members) **OR**  
     - No DRI (Directly Responsible Individual) assigned.
   - The calculation must be performed on the latest available data and re-evaluated whenever underlying data changes (or at a scheduled interval defined by data refresh).

2. **Timestamp Display (AC-8)**  
   - A clearly labeled “Generated on” timestamp shall be displayed in a consistent location (e.g., page header or footer).  
   - The timestamp must be in a human-readable format (e.g., `YYYY-MM-DD HH:MM UTC`).  
   - The timestamp must update every time the RAG status is recomputed and reflect the actual time of that computation.

3. **Consistent RAG Application (AC-9)**  
   - All views (overview grid, detail panel, export) that show a project health indicator must use the identical RAG logic described in FR-3 and Requirement 1.  
   - No manual overrides or outdated cached values shall be shown unless explicitly marked as “overridden” and still accompanied by the computed status.  
   - A reconciliation tool (or automated test) must verify that any displayed status matches the engine output for the same dataset.

4. **Scannable UI (AC-10)**  
   - The page layout must present project health in a way that a user can locate and interpret the RAG status of a specific project within 30 seconds of opening the view.  
   - Design elements required:  
     - High-contrast color coding consistent with RAG (green, amber, red) applied to status icons or badges.  
     - Prioritized visual hierarchy: status icon/color and project name placed prominently, with secondary details hidden or collapsed.  
     - No more than one click or scroll to identify the status for a given project (default sort or filter by status allowed).  
     - Compliance measured via time-on-task usability tests or heuristic review against the 30‑second threshold.

## Acceptance Criteria

- **AC-8 – Timestamp present:**  
  - The artifact displays “Generated on: <timestamp>”.  
  - Timestamp matches the system’s last RAG computation time (verified via API or log).  
  - The display is visible without scrolling on a 1920×1080 viewport.

- **AC-9 – Consistent rules:**  
  - For a sample of 10 projects with known underlying data, manually calculated RAG matches the displayed status 100%.  
  - Automated regression tests that simulate different datasets (including edge cases like 50% active, on-hold+plan, build broken) produce the expected RAG.  
  - No UI component shows a status that deviates from the engine output.

- **AC-10 – Scannable within 30 seconds:**  
  - In a usability test with at least 5 participants, 90% of tasks (“find the status of project X”) complete within 30 seconds.  
  - Heuristic evaluation confirms that colour, iconography, and layout conform to the scannability design guidelines.  
  - The 30‑second measurement includes time from page load to the user correctly identifying the status.

## Out of Scope
- Historical RAG trends or snapshots over time (beyond the current “Generated on” moment).
- Manual override interfaces or approval workflows for status changes.
- Custom RAG rule definitions for individual teams (only the global FR-3 rules are in scope).
- Drill‑down details responsible for the status (e.g., list of specific blockers) – unless needed to keep status visible within the 30‑second scan (basic label only).
- Changes to data source ingestion, data quality, or upstream services.

## Requirements

> _Authored by the business-analyst — last updated 2026-08-04._

### REQ-1: Deterministic RAG Engine

The `deriveRagStatus` function in `Builderforce.ai/frontend/src/dashboard/cross-project-health/portfolioHealthData.tsx` must be **the single source of truth** for RAG computation. No other health mechanism (`frontend/src/lib/projectHealth.ts`'s `computeProjectHealth`, which operates on the healthy/watch/at_risk/critical delivery-health tier system and is NOT a RAG engine) may display or imply a RAG status.

**REQ-1.1 — Strict rule ordering.** The engine must evaluate rules in priority order (Red > Amber > Green), returning the FIRST match. Red triggers short-circuit Amber and Green.

**REQ-1.2 — Input data contract.** The engine must accept an explicit structured input rather than inferring from prose strings. Required inputs:

| Field | Type | Source |
|---|---|---|
| `activeWorkPct` | `number` (0–100) | `(inProgress + inReview) / totalNonArchived × 100` |
| `buildBroken` | `boolean` | CI status from project config or latest run |
| `hasActiveBlocker` | `boolean` | Any non-archived task has `isBlocked === true` |
| `projectOnHold` | `boolean` | Project status === 'On Hold' |
| `hasRecoveryPlan` | `boolean` | Recovery plan document exists and is published |
| `teamEmpty` | `boolean` | Project member count === 0 |
| `hasDri` | `boolean` | Project has a non-null `driUserId` or equivalent |
| `hasActiveFailure` | `boolean` | buildBroken OR hasActiveBlocker OR activeCriticalIncidents > 0 |

**REQ-1.3 — Decision table.** The exact rules from FR-3, formalized:

| Priority | RAG | Condition |
|---|---|---|
| 1 | 🔴 Red | `buildBroken === true` |
| 2 | 🔴 Red | `activeWorkPct === 0` |
| 3 | 🔴 Red | `teamEmpty === true` |
| 4 | 🔴 Red | `hasDri === false` |
| 5 | 🟡 Amber | `hasActiveBlocker === true` |
| 6 | 🟡 Amber | `projectOnHold === true && hasRecoveryPlan === true` |
| 7 | 🟡 Amber | `activeWorkPct >= 25 && activeWorkPct <= 50` |
| 8 | 🟢 Green | `activeWorkPct > 50 && hasActiveFailure === false` |
| — | 🟡 Amber | Fallback (any condition not matched above) |

**REQ-1.4 — No prose-parsing fallback.** Remove the existing regex-based heuristics (`/build/.test(p.keyBlocker.toLowerCase())`, `p.keyBlocker.length > 10`) from `deriveRagStatus`. All decisions must trace to structured boolean fields.

**REQ-1.5 — Override semantics (AC-9 compliance).** If a project's `rag` field is explicitly set (policy override), the engine must STILL compute the raw RAG and return both values:
- `computedRag`: the engine's deterministic output
- `effectiveRag`: the override if set, otherwise the computed value
- `isOverridden`: boolean flag

The UI must display the effective status AND, when overridden, a visual indicator (e.g., "⚠ Overridden — computed: {computedRag}"). The `buildPortfolioSummary` function must count by `computedRag` for an honest health picture, and separately report overrides.

### REQ-2: "Generated on" Timestamp (AC-8)

**REQ-2.1 — Format.** The timestamp must be rendered in the dashboard header as:

```
Generated on: YYYY-MM-DD HH:MM UTC
```

No locale-dependent formatting (`toLocaleString()`). Use explicit UTC methods (`getUTCFullYear`, `getUTCMonth`, etc.) or an ISO formatter locked to UTC.

**REQ-2.2 — Source of truth.** The `generateAt` field on `PortfolioSummary` must be settable from the caller and recorded at the EXACT moment `buildPortfolioSummary` is invoked. The existing pattern (`new Date().toISOString()`) is acceptable but the timestamp passed to the UI must be the server-side computation time, not the client render time.

**REQ-2.3 — Visibility.** The timestamp must appear in the page `<header>` block, above the fold on a 1920×1080 viewport, with the label "Generated on" in a consistent, readable font size (≥0.8rem). It must be present on EVERY view that displays RAG status — overview grid, detail panel, and any export artifact.

**REQ-2.4 — Update trigger.** The timestamp must refresh whenever `buildPortfolioSummary` is recomputed. For the static data module, this means the timestamp changes when the data module is re-evaluated (page load). When wired to live data, it must reflect the API fetch completion time.

### REQ-3: Consistent RAG Application (AC-9)

**REQ-3.1 — Single engine.** The `deriveRagStatus` function must be the ONLY function that produces a RAG label in the system. Import and call it from every surface that displays project health.

**REQ-3.2 — Reconciliation test harness.** Provide a test-helper function `validateRagConsistency(projects: ProjectHealthInput[]): RagConsistencyReport` that:
1. Runs `deriveRagStatus` on every project
2. Compares output against expected values for a known dataset
3. Returns pass/fail and a detailed mismatch report

**REQ-3.3 — Regression test cases.** The reconciliation test must cover these edge cases (minimum):

| # | Scenario | Expected |
|---|---|---|
| 1 | activeWorkPct=80, no failures | Green |
| 2 | activeWorkPct=50, no blockers | Amber (not Green — ≤50) |
| 3 | activeWorkPct=25, no blockers | Amber (boundary — 25 inclusive) |
| 4 | activeWorkPct=24, no blockers | Amber (fallback) |
| 5 | activeWorkPct=80, buildBroken=true | Red (build broken beats Green) |
| 6 | activeWorkPct=0, team non-empty | Red |
| 7 | teamEmpty=true, activeWorkPct=50 | Red |
| 8 | hasDri=false, everything else green | Red |
| 9 | hasActiveBlocker=true, activeWorkPct=60 | Amber |
| 10 | projectOnHold=true, hasRecoveryPlan=true, activeWorkPct=80 | Amber |
| 11 | projectOnHold=true, hasRecoveryPlan=false | Amber (fallback — no recovery plan means neither Amber nor Green match) |
| 12 | activeWorkPct=51, hasActiveFailure=true | Amber (active failure present → not Green, falls to Amber) |

**REQ-3.4 — No dual health systems.** `frontend/src/lib/projectHealth.ts` and `frontend/src/components/ProjectHealth.tsx` must NOT display or imply a RAG status. They represent delivery-health (DORA-based speedometer), which is a distinct signal. The two systems must coexist without confusion: RAG = portfolio health snapshot; delivery-health = engineering throughput gauge.

### REQ-4: Scannable UI (AC-10)

**REQ-4.1 — Status-first visual hierarchy.** Each project card must present the RAG badge (colour + icon + label) as the most visually prominent element in the card header, before the project name and secondary details. The existing layout in `CrossProjectHealthDashboard.tsx`'s `ProjectCard` is close but must ensure the RAG badge is positioned in the card's visual scan-path (top-right or top-left, consistent across all cards).

**REQ-4.2 — High-contrast colour coding.** RAG colours must meet WCAG AA contrast against the card background:
- Green: `#16a34a` (darker than current `#22c55e` for AA on white)
- Amber: `#d97706` (darker than current `#f59e0b` for AA on white)
- Red: `#dc2626` (current `#ef4444` is borderline)

**REQ-4.3 — Default sort.** The project card grid must sort cards by severity (Red first, then Amber, then Green) by default, so the worst-status projects are seen first without scrolling.

**REQ-4.4 — Status-at-a-glance filter.** Provide a pill/tab filter bar above the project grid: "All (N) | 🔴 Red (N) | 🟡 Amber (N) | 🟢 Green (N)". Selecting a pill filters the grid to only that status. The default view is "All".

**REQ-4.5 — Card density.** Each card must present in this order, with no more than 5 visual elements before the status is clear:
1. RAG badge (colour + icon + label)
2. Project name
3. Active work % bar
4. Key blocker (one line, truncated at 80 chars with "…" if longer)
5. Recommended action (one line)

The current card layout already approximates this; the main changes are the explicit sort, the filter bar, and ensuring the RAG badge is the first scanned element.

### REQ-5: Data Contract Traceability

Each requirement above must be traceable to an acceptance criterion. The mapping is:

| Requirement | AC | FR |
|---|---|---|
| REQ-1.1–1.5 | AC-9 | FR-3 Rule 1 |
| REQ-2.1–2.4 | AC-8 | FR-3 Rule 2 |
| REQ-3.1–3.4 | AC-9 | FR-3 Rule 3 |
| REQ-4.1–4.5 | AC-10 | FR-3 Rule 4 |
| REQ-5 | AC-9 | — |

### REQ-6: Non-Functional Requirements

- **NFR-1 (Performance):** RAG computation for 100 projects must complete in under 50ms in a browser context (pure function, no I/O).
- **NFR-2 (Testability):** `deriveRagStatus` must be a pure exported function with zero side effects, importable by test suites without mocking.
- **NFR-3 (Backward compatibility):** The `ProjectHealth` interface in `portfolioHealthData.tsx` must retain the optional `rag?: RAG` field for existing consumers but add `computedRag` and `isOverridden` as described in REQ-1.5.
- **NFR-4 (Accessibility):** RAG badges must use `role="status"` with an `aria-label` containing the status text (not just the emoji). Colour must not be the sole differentiator — text labels must accompany every colour indicator.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._