> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #277
> _Each agent that updates this PRD signs its change below._

# PRD: Re-runnable Diagnostic Tool

## Problem & Goal

Users currently cannot re-run the diagnostic after it has been executed once within a session. If system conditions change — such as new errors appearing, configuration updates being applied, or intermittent issues resolving — users must restart or navigate away to get fresh diagnostic results. This creates friction, delays troubleshooting, and produces stale data that does not reflect the current system state.

**Goal:** Allow users to manually trigger the diagnostic at any time, as many times as needed, so that diagnostic results always reflect the most current system state.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **End Users / Customers** | Quickly re-check system health after attempting a self-fix without reloading the page or restarting a flow |
| **Support Agents** | Capture a fresh diagnostic snapshot during a live support session to confirm whether a reported issue persists |
| **System Administrators** | Validate that a configuration change or remediation has resolved the flagged condition |
| **QA / DevOps Engineers** | Trigger repeated diagnostic runs during testing and deployment verification |

---

## Scope

This work covers the UI control, triggering mechanism, and result-refresh behavior for re-running an existing diagnostic. It does not cover creating new diagnostic checks or altering the underlying diagnostic logic.

---

## Functional Requirements

### FR-1 — Re-Run Trigger Control
- A clearly labeled **"Re-run Diagnostic"** button (or equivalent accessible control) must be persistently visible on the diagnostic results view after the first run completes.
- The control must be available regardless of whether the previous run returned a passing, failing, or partial result.

### FR-2 — Execution Behavior
- Activating the control must execute the full diagnostic suite from scratch, identical to the initial run.
- Each re-run must be treated as an independent execution; no results from prior runs must be cached or pre-populated.
- Re-runs must be executable an unlimited number of times within a session.

### FR-3 — Loading / In-Progress State
- While the diagnostic is running, the UI must display a clear in-progress indicator (spinner, progress bar, or equivalent).
- The Re-run button must be disabled during execution to prevent concurrent runs.
- Any previously displayed results must be replaced by the in-progress state immediately upon trigger activation.

### FR-4 — Result Refresh
- Upon completion, the results view must be fully replaced with the latest diagnostic output.
- The timestamp of the most recent run must be displayed (e.g., "Last run: Today at 14:32").
- If results differ from the previous run, no diff or change highlight is required (see Out of Scope), but the new results must stand alone as the current state.

### FR-5 — Error Handling
- If the re-run fails to execute (network error, timeout, service unavailability), the UI must display a descriptive error message and restore the Re-run button so the user can retry.
- The last successfully retrieved results, if any, must remain visible beneath the error message with a clear label indicating they are from a prior run.

### FR-6 — Accessibility
- The Re-run control must be keyboard-navigable and screen-reader accessible with an appropriate ARIA label.
- In-progress and completion states must be announced to assistive technologies.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | After the initial diagnostic run completes, a Re-run Diagnostic button is visible and interactive on the results screen. |
| AC-2 | Clicking Re-run Diagnostic immediately shows an in-progress state and clears the previous results from view. |
| AC-3 | The Re-run button is disabled and non-interactive while a diagnostic run is in progress. |
| AC-4 | On successful completion, the results view displays only the output of the latest run, with an updated timestamp. |
| AC-5 | Re-running the diagnostic produces the same type of output as the initial run with no stale cached data. |
| AC-6 | A user can successfully trigger at least 5 consecutive re-runs within a single session without error (under normal conditions). |
| AC-7 | If a re-run fails, an error message is shown, the Re-run button is re-enabled, and previously successful results (if any) remain visible and labeled as stale. |
| AC-8 | The Re-run button is reachable and operable via keyboard alone, and its state changes are announced by a screen reader. |

---

## Out of Scope

- **Scheduled / automatic re-runs** — periodic polling or time-based triggers are not included in this release.
- **Result diffing or change highlighting** — comparing the current run to previous runs is not included.
- **Run history / audit log** — storing, displaying, or exporting multiple past diagnostic results is not included.
- **Partial or selective re-runs** — running a subset of diagnostic checks is not included.
- **New diagnostic checks** — no additions or modifications to the underlying diagnostic logic are included.
- **Cross-session persistence** — results from a previous session are not retained or surfaced.
- **Concurrent multi-user diagnostics** — this scope covers single-user, single-session interaction only.