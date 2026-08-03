> **PRD** — drafted by Ada (Sr. Product Mgr) · task #876
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Before/After Metrics for AC-1 Reduction Verification

## Problem & Goal
**Problem:** Stakeholders cannot independently verify that AC-1's target of a 25% item count reduction has been met. There is no persistent evidence of initial (before) item counts, final (after) item counts, lists of archived or deleted items, or the calculated percentage change. This lack of traceability blocks audit readiness and trust in the reduction outcome.

**Goal:** Deliver a reporting capability that captures baseline (before) metrics, tracks item archival/deletion actions, computes final (after) metrics, and displays the percentage reduction alongside item-level lists. The solution must provide clear, verifiable evidence that AC-1 achieved a ≥25% reduction.

## Target Users / ICP Roles
- **Audit & Compliance Leads** – need exportable evidence of item count changes and lists of removed items.
- **Program Managers** – need a dashboard to monitor progress toward the 25% reduction target.
- **Data Stewards / Operations** – responsible for archiving/deleting items; need a view of pending vs. removed items.

## Scope
- Capture a baseline snapshot of total item count before reduction activities begin.
- Track every archival and deletion event, logging item ID, action type, timestamp, and actor.
- Generate an after snapshot once reduction is declared complete.
- Compute absolute and percentage reduction between before and after snapshots.
- Display a verifiable list of all archived and deleted items.
- Surface these metrics in a dedicated verification report (UI + export).
- Hard requirement: evidence must survive data retention changes (immutable audit log).

## Functional Requirements
**FR-1: Baseline Snapshot**
- User triggers a “Set Baseline” action from the AC-1 context.
- System records: snapshot ID, timestamp, total item count, and a serialized list of item IDs/names (as of that moment).
- Only one active baseline allowed per AC-1 initiative at a time.

**FR-2: Change Tracking**
- For every archive or delete operation on in-scope items, the system logs an immutable event containing item ID, action (archive/delete), timestamp, and responsible actor.
- The system prevents permanent deletion without an audit trail.

**FR-3: Final Snapshot**
- User triggers “Finalize Reduction” when target activities are complete.
- System captures final total item count and timestamp; marks the baseline as completed.

**FR-4: Percentage Reduction Calculation**
- `Reduction % = ((Baseline Count - Final Count) / Baseline Count) * 100`
- The system highlights whether the result meets the ≥25% threshold.
- Outlier handling: if final count exceeds baseline, display “No reduction achieved.”

**FR-5: Verification Report**
- Show: baseline count, final count, absolute reduction, percentage reduction, and a clear pass/fail indicator for 25%.
- Show full lists of archived items and deleted items with timestamps and actors.
- Allow export of the report (CSV/PDF) containing all evidence.

**FR-6: Immutability & Audit Trail**
- All snapshots and action logs are append-only and versioned. No edits permitted post-recording.
- Report includes cryptographic proof of snapshot integrity (optional, but must support future audit requirements).

## Acceptance Criteria
1. An auditor can open the AC-1 verification report and see: a baseline item count, a final item count, and the exact percentage reduction calculated.
2. The report explicitly displays “Target Achieved: 25% reduction” if the calculation meets or exceeds 25%, and “Target Not Met” otherwise.
3. The report contains two separate, complete lists: one of all archived items, one of all deleted items, each with ID, name, action type, timestamp, and actor.
4. No item counted in the baseline can disappear without appearing in the archived or deleted lists.
5. Exporting the report in CSV includes all columns from the lists and summary metrics; PDF preserves the same information.
6. The baseline snapshot cannot be overwritten once finalization is triggered. Attempts to re-baseline require explicit reset with a confirmation and audit log entry.
7. A test run with known input (e.g., 100 baseline items, 30 archived, 10 deleted → final count 60) shows 40% reduction and both lists match the actions performed.
8. The entire flow (baseline → archive/delete → finalize → view report) can be completed by a single user with appropriate permissions, and the report is accessible to auditors with read-only access to AC-1.

## Out of Scope
- Automatic triggering of deletions/archivals based on rules (manual operations only).
- Real-time dashboard for ongoing reduction; only post-finalization report required.
- Reverting archived/deleted items back to active state — once tracked, they remain in the list for audit.
- Cross-initiative aggregation or comparison (this is specific to AC-1).
- Support for partial snapshots (e.g., per category) — entire scope is snapshotted as a whole.
- Notifications or alerts when threshold is approached.

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