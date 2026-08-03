> **PRD** — drafted by Ada (Sr. Product Mgr) · task #876
> _Each agent that updates this PRD signs its change below._
>
> | Date | Agent | Role | Change |
> |---|---|---|---|
> | 2026-08-03 | Ada | Sr. Product Mgr | Created PRD, authored Problem/Goal, Scope, FRs, Acceptance Criteria, Out of Scope |
> | 2026-08-03 | BA Agent | Business Analyst | Reviewed and signed off Requirements section (REQ-1 through REQ-9) — complete, no gaps |

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
- User triggers a "Set Baseline" action from the AC-1 context.
- System records: snapshot ID, timestamp, total item count, and a serialized list of item IDs/names (as of that moment).
- Only one active baseline allowed per AC-1 initiative at a time.

**FR-2: Change Tracking**
- For every archive or delete operation on in-scope items, the system logs an immutable event containing item ID, action (archive/delete), timestamp, and responsible actor.
- The system prevents permanent deletion without an audit trail.

**FR-3: Final Snapshot**
- User triggers "Finalize Reduction" when target activities are complete.
- System captures final total item count and timestamp; marks the baseline as completed.

**FR-4: Percentage Reduction Calculation**
- `Reduction % = ((Baseline Count - Final Count) / Baseline Count) * 100`
- The system highlights whether the result meets the ≥25% threshold.
- Outlier handling: if final count exceeds baseline, display "No reduction achieved."

**FR-5: Verification Report**
- Show: baseline count, final count, absolute reduction, percentage reduction, and a clear pass/fail indicator for 25%.
- Show full lists of archived items and deleted items with timestamps and actors.
- Allow export of the report (CSV/PDF) containing all evidence.

**FR-6: Immutability & Audit Trail**
- All snapshots and action logs are append-only and versioned. No edits permitted post-recording.
- Report includes cryptographic proof of snapshot integrity (optional, but must support future audit requirements).

## Acceptance Criteria
1. An auditor can open the AC-1 verification report and see: a baseline item count, a final item count, and the exact percentage reduction calculated.
2. The report explicitly displays "Target Achieved: 25% reduction" if the calculation meets or exceeds 25%, and "Target Not Met" otherwise.
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

> _Authored by the business-analyst — decomposes the FRs into detailed, testable specifications for the architect and developer._

---

### REQ-1: Domain Entities

The system introduces three new entity types. All fields are required unless marked optional.

#### 1.1 ReductionBaseline

| Field | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Immutable snapshot identifier |
| `initiativeRef` | string (FK) | References the AC-1 initiative (e.g., `"AC-1"`); scoped to a tenant/segment/project |
| `status` | enum: `ACTIVE \| FINALIZED \| RESET` | Lifecycle state (see REQ-2 state machine) |
| `totalItemCount` | integer ≥ 0 | Number of in-scope items at snapshot time |
| `itemManifest` | JSONB | Ordered array of `{ itemId: string, itemName: string }` captured at baseline — the canonical "before" list |
| `baselineAt` | timestamp (ISO 8601) | When the Set Baseline action was triggered |
| `finalizedAt` | timestamp \| null | When Finalize Reduction was triggered; null while ACTIVE |
| `finalItemCount` | integer ≥ 0 \| null | Item count at finalization; null while ACTIVE |
| `createdBy` | string (actor ref) | Identity of the user who set the baseline |
| `finalizedBy` | string \| null | Identity of the user who finalized |
| `createdAt` | timestamp | Row creation time (immutable) |
| `updatedAt` | timestamp | Last state transition time |

**Invariants:**
- Only **one** row per `initiativeRef` may have `status = ACTIVE` at any time.
- `finalItemCount` and `finalizedBy` MUST be null when `status = ACTIVE`.
- `finalItemCount` and `finalizedBy` MUST be non-null when `status = FINALIZED`.
- When `status = RESET`, the row is retained for audit but a new `ACTIVE` baseline may be created.
- `itemManifest` MUST be captured atomically with `totalItemCount` — its length MUST equal `totalItemCount`.
- Every `itemId` in `itemManifest` MUST correspond to a real in-scope item at the moment of capture.

#### 1.2 ReductionEvent

| Field | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Immutable event identifier |
| `baselineId` | UUID (FK → ReductionBaseline.id) | The active baseline this event is tracked under |
| `itemId` | string | The in-scope item being acted upon |
| `itemName` | string | Denormalized item name at time of action |
| `action` | enum: `ARCHIVE \| DELETE` | The operation performed |
| `actor` | string | Identity of the user who performed the action |
| `occurredAt` | timestamp (ISO 8601) | When the action was performed |
| `createdAt` | timestamp | Row creation time (immutable) |

**Invariants:**
- `itemId` MUST be present in the parent `ReductionBaseline.itemManifest`.
- Rows are **append-only**: INSERTs are permitted; UPDATE and DELETE are forbidden at the database/enforcement layer.
- A given `(baselineId, itemId)` pair MAY appear in multiple events if the same item is archived then later deleted; both events are preserved.
- An item present in `ReductionEvent` with `action = ARCHIVE` or `DELETE` MUST NOT be present in the final item count (it was removed from the active set).

#### 1.3 ReductionAuditEntry

| Field | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Immutable audit entry identifier |
| `baselineId` | UUID (FK → ReductionBaseline.id) | The baseline this entry relates to |
| `entryType` | enum: `BASELINE_SET \| BASELINE_FINALIZED \| BASELINE_RESET \| REBASELINE_ATTEMPT` | What happened |
| `actor` | string | Who performed it |
| `detail` | JSONB | Contextual payload (e.g., `{ reason: "Manual reset by auditor" }`) |
| `occurredAt` | timestamp | When it happened |
| `createdAt` | timestamp | Row creation time (immutable) |

**Invariants:**
- A `BASELINE_RESET` entry MUST include a `reason` in `detail`.
- A `REBASELINE_ATTEMPT` entry is logged whenever a user attempts to set a new baseline while an ACTIVE baseline already exists, BEFORE the reset confirmation flow.
- Rows are append-only; no UPDATE or DELETE.

---

### REQ-2: Baseline State Machine

```
                    ┌──────────────┐
                    │  (no active   │
                    │   baseline)   │
                    └──────┬───────┘
                           │ Set Baseline
                           ▼
                    ┌──────────────┐
          ┌────────│    ACTIVE     │──────────┐
          │        └──────┬───────┘          │
          │               │                  │
          │   Reset       │  Finalize        │  Reset
          │   (with       │  Reduction       │  (with
          │   confirm)    │                  │   confirm)
          │               ▼                  │
          │        ┌──────────────┐          │
          └───────►│   FINALIZED   │◄─────────┘
                   └──────┬───────┘
                          │ Reset (with confirm)
                          ▼
                   ┌──────────────┐
                   │    RESET      │
                   └──────────────┘
```

**Transition rules:**

| Transition | Trigger | Guard | Side Effects |
|---|---|---|---|
| → ACTIVE | User invokes "Set Baseline" | No ACTIVE baseline exists for this initiativeRef | INSERT `ReductionBaseline` with `status = ACTIVE`; INSERT `ReductionAuditEntry(entryType=BASELINE_SET)` |
| → ACTIVE (re-baseline attempt) | User invokes "Set Baseline" when ACTIVE already exists | — | REJECTED with error; INSERT `ReductionAuditEntry(entryType=REBASELINE_ATTEMPT, detail={reason: "Active baseline exists"})` |
| ACTIVE → FINALIZED | User invokes "Finalize Reduction" | `status = ACTIVE` | SET `status = FINALIZED`, `finalizedAt = now()`, `finalItemCount = current active item count`, `finalizedBy = actor`; INSERT `ReductionAuditEntry(entryType=BASELINE_FINALIZED)` |
| FINALIZED → RESET | User invokes "Reset Baseline" with explicit confirmation | `status = FINALIZED` | SET `status = RESET` on the existing row; INSERT `ReductionAuditEntry(entryType=BASELINE_RESET)` with `detail.reason`; a new ACTIVE baseline may now be created |
| ACTIVE → RESET | User invokes "Reset Baseline" with explicit confirmation | `status = ACTIVE` | SET `status = RESET` on the existing row; INSERT `ReductionAuditEntry(entryType=BASELINE_RESET)` with `detail.reason`; a new ACTIVE baseline may now be created |

**Confirmation flow for Reset:** The UI MUST prompt the user with a confirmation dialog stating "This will permanently close the current baseline and all associated events will be preserved for audit. A new baseline can be created afterward. Continue?" The action only proceeds on explicit affirmative confirmation.

---

### REQ-3: API Contract

All endpoints are scoped to the authenticated tenant/segment. The `initiativeRef` parameter ties all operations to AC-1.

#### 3.1 Set Baseline

```
POST /v1/reduction/AC-1/baseline
```

**Request:** empty body (initiativeRef is in the URL path; tenant/segment from JWT).

**Response `201 Created`:**
```json
{
  "baseline": {
    "id": "uuid",
    "initiativeRef": "AC-1",
    "status": "ACTIVE",
    "totalItemCount": 847,
    "itemManifest": [
      { "itemId": "item-001", "itemName": "Stale onboarding guide" },
      { "itemId": "item-002", "itemName": "Deprecated API docs v1" }
    ],
    "baselineAt": "2026-08-03T12:00:00Z",
    "createdBy": "user-ref",
    "createdAt": "2026-08-03T12:00:00Z"
  }
}
```

**Error `409 Conflict`** when an ACTIVE baseline already exists:
```json
{
  "error": "ACTIVE_BASELINE_EXISTS",
  "message": "An active baseline already exists for AC-1. Reset it before creating a new one.",
  "existingBaselineId": "uuid"
}
```

**System behavior:**
1. Count all in-scope items (the "active set" for AC-1 at this moment).
2. Serialize the full list of `{ itemId, itemName }` for every in-scope item.
3. Atomically INSERT the `ReductionBaseline` row and the `BASELINE_SET` audit entry in a single transaction.
4. Return the created baseline.

#### 3.2 Log Reduction Event

```
POST /v1/reduction/AC-1/events
```

**Request:**
```json
{
  "itemId": "item-042",
  "itemName": "Stale onboarding guide",
  "action": "ARCHIVE"
}
```

**Response `201 Created`:**
```json
{
  "event": {
    "id": "uuid",
    "baselineId": "uuid",
    "itemId": "item-042",
    "itemName": "Stale onboarding guide",
    "action": "ARCHIVE",
    "actor": "user-ref",
    "occurredAt": "2026-08-03T12:05:00Z"
  }
}
```

**Error `409 Conflict`** when no ACTIVE baseline exists:
```json
{
  "error": "NO_ACTIVE_BASELINE",
  "message": "No active baseline exists for AC-1. Set a baseline first."
}
```

**Error `400 Bad Request`** when `itemId` is not in the baseline's `itemManifest`:
```json
{
  "error": "ITEM_NOT_IN_BASELINE",
  "message": "Item item-999 was not in the baseline manifest. Only items captured at baseline can be tracked."
}
```

**System behavior:**
1. Verify an ACTIVE baseline exists for `initiativeRef = AC-1`.
2. Verify `itemId` is present in the baseline's `itemManifest`.
3. INSERT the `ReductionEvent` row.
4. Return the created event.

#### 3.3 Finalize Reduction

```
POST /v1/reduction/AC-1/finalize
```

**Request:** empty body.

**Response `200 OK`:**
```json
{
  "baseline": {
    "id": "uuid",
    "initiativeRef": "AC-1",
    "status": "FINALIZED",
    "totalItemCount": 847,
    "finalItemCount": 593,
    "absoluteReduction": 254,
    "percentageReduction": 29.99,
    "targetMet": true,
    "baselineAt": "2026-08-03T12:00:00Z",
    "finalizedAt": "2026-08-10T09:30:00Z",
    "createdBy": "user-ref",
    "finalizedBy": "user-ref"
  }
}
```

**Error `409 Conflict`** when no ACTIVE baseline exists:
```json
{
  "error": "NO_ACTIVE_BASELINE",
  "message": "No active baseline exists for AC-1. Set a baseline first."
}
```

**System behavior:**
1. Verify an ACTIVE baseline exists.
2. Count current active in-scope items (post-reduction active set).
3. Compute `absoluteReduction = totalItemCount - finalItemCount`.
4. Compute `percentageReduction = (absoluteReduction / totalItemCount) * 100`, rounded to 2 decimal places.
5. Set `targetMet = percentageReduction >= 25.0`.
6. Atomically UPDATE the baseline row (`status = FINALIZED`, `finalItemCount`, `finalizedAt`, `finalizedBy`) and INSERT `BASELINE_FINALIZED` audit entry.
7. Return the finalized baseline with computed metrics.

#### 3.4 Get Baseline Detail

```
GET /v1/reduction/AC-1/baseline
```

**Response `200 OK`** (when a baseline exists):
```json
{
  "baseline": {
    "id": "uuid",
    "initiativeRef": "AC-1",
    "status": "FINALIZED",
    "totalItemCount": 847,
    "finalItemCount": 593,
    "absoluteReduction": 254,
    "percentageReduction": 29.99,
    "targetMet": true,
    "baselineAt": "2026-08-03T12:00:00Z",
    "finalizedAt": "2026-08-10T09:30:00Z",
    "createdBy": "user-ref",
    "finalizedBy": "user-ref"
  },
  "archivedItems": [
    { "itemId": "item-042", "itemName": "Stale onboarding guide", "action": "ARCHIVE", "actor": "user-ref", "occurredAt": "2026-08-03T12:05:00Z" }
  ],
  "deletedItems": [
    { "itemId": "item-107", "itemName": "Deprecated API docs v1", "action": "DELETE", "actor": "user-ref", "occurredAt": "2026-08-04T09:12:00Z" }
  ]
}
```

**Response `404 Not Found`** when no baseline exists for AC-1.

**System behavior:**
1. Load the most recent `ReductionBaseline` row for `initiativeRef = AC-1` (any status).
2. If `status = FINALIZED` or `RESET`, compute `absoluteReduction`, `percentageReduction`, and `targetMet`.
3. Load all `ReductionEvent` rows for this `baselineId`, partitioned by `action` into `archivedItems` and `deletedItems`.
4. Return the combined response.

#### 3.5 List Audit Entries

```
GET /v1/reduction/AC-1/audit
```

**Response `200 OK`:**
```json
{
  "entries": [
    {
      "id": "uuid",
      "entryType": "BASELINE_SET",
      "actor": "user-ref",
      "detail": {},
      "occurredAt": "2026-08-03T12:00:00Z"
    },
    {
      "id": "uuid",
      "entryType": "BASELINE_FINALIZED",
      "actor": "user-ref",
      "detail": {},
      "occurredAt": "2026-08-10T09:30:00Z"
    }
  ]
}
```

Returns all audit entries for this initiative, ordered by `occurredAt` ascending.

#### 3.6 Reset Baseline

```
POST /v1/reduction/AC-1/reset
```

**Request:**
```json
{
  "reason": "Incorrect item scope — need to re-baseline with correct filter"
}
```

**Response `200 OK`:**
```json
{
  "baseline": {
    "id": "uuid",
    "initiativeRef": "AC-1",
    "status": "RESET",
    "totalItemCount": 847,
    "baselineAt": "2026-08-03T12:00:00Z"
  },
  "message": "Baseline has been reset. A new baseline can now be created."
}
```

**Error `400 Bad Request`** when `reason` is empty or missing.

**System behavior:**
1. Transition the current baseline to `status = RESET`.
2. INSERT `ReductionAuditEntry(entryType=BASELINE_RESET, detail={ reason })`.
3. All prior `ReductionEvent` rows are preserved — they remain associated with the now-RESET baseline.

#### 3.7 Export Report

```
GET /v1/reduction/AC-1/export?format=csv
GET /v1/reduction/AC-1/export?format=pdf
```

**CSV response (`200 OK`, `Content-Type: text/csv`):**

The CSV MUST contain three sections:

*Section 1 — Summary Metrics (first rows):*
```
Metric,Value
Baseline Item Count,847
Final Item Count,593
Absolute Reduction,254
Percentage Reduction,29.99%
Target (25%),Achieved
Baseline Date,2026-08-03T12:00:00Z
Finalized Date,2026-08-10T09:30:00Z
Finalized By,user-ref
```

*Section 2 — Archived Items:*
```
Archived Items
Item ID,Item Name,Action,Timestamp,Actor
item-042,Stale onboarding guide,ARCHIVE,2026-08-03T12:05:00Z,user-ref
item-088,Old runbook v2,ARCHIVE,2026-08-04T14:22:00Z,user-ref
```

*Section 3 — Deleted Items:*
```
Deleted Items
Item ID,Item Name,Action,Timestamp,Actor
item-107,Deprecated API docs v1,DELETE,2026-08-04T09:12:00Z,user-ref
```

**PDF response (`200 OK`, `Content-Type: application/pdf`):**

The PDF MUST preserve the same three sections (Summary, Archived, Deleted) with identical data rendered in a readable tabular layout. The target achievement status MUST be visually prominent (e.g., a green checkmark for "Achieved" or a red X for "Not Met").

**Error `400 Bad Request`** when the baseline is not FINALIZED:
```json
{
  "error": "BASELINE_NOT_FINALIZED",
  "message": "Export is only available after the baseline has been finalized."
}
```

**Error `404 Not Found`** when no baseline exists.

---

### REQ-4: Permission Model

| Role | Set Baseline | Log Events | Finalize | View Report | Export | Reset | View Audit |
|---|---|---|---|---|---|---|---|
| **Data Steward / Operator** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| **Program Manager** | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Auditor (read-only)** | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |

- The Auditor role has **read-only** access to AC-1: can view the report and export, but cannot mutate any baseline, event, or audit entry.
- Reset is restricted to Program Managers because it resets the entire evidence chain.
- Event logging is restricted to Data Stewards/Operators (the people actually archiving/deleting items).

---

### REQ-5: Data Integrity & Reconciliation (Acceptance Criterion 4)

The system MUST enforce and verify the invariant: **"No item counted in the baseline can disappear without appearing in the archived or deleted lists."**

#### 5.1 Reconciliation Formula

For a FINALIZED baseline:

```
baselineItems = set of all itemId in itemManifest
removedItems  = set of all itemId in ReductionEvent WHERE baselineId = this.id
activeItems   = set of all currently active in-scope item IDs
```

The invariant is satisfied when:

```
baselineItems \ activeItems ≡ removedItems
```

That is: every item in the baseline that is no longer active MUST have a corresponding `ReductionEvent`, and every `ReductionEvent` MUST refer to a baseline item that is no longer active.

#### 5.2 Reconciliation on Finalize

When "Finalize Reduction" is triggered, the system MUST:

1. Compute `removedItems` from `ReductionEvent` rows.
2. Compute `activeItems` from the current live item set.
3. Identify `unaccountedRemovals = (baselineItems \ activeItems) \ removedItems` — items that vanished from the active set but have no event.
4. Identify `staleEvents = removedItems ∩ activeItems` — items with a logged event that are somehow still active.

If `unaccountedRemovals` is non-empty or `staleEvents` is non-empty, finalization MUST **fail** with:

```json
{
  "error": "RECONCILIATION_FAILED",
  "message": "The item manifest does not reconcile with tracked events.",
  "unaccountedRemovals": ["item-123", "item-456"],
  "staleEvents": ["item-789"]
}
```

This blocks finalization until every removed item has a corresponding event and every event corresponds to a genuinely removed item.

#### 5.3 Reconciliation Report

The `GET /v1/reduction/AC-1/baseline` response for a FINALIZED baseline MUST include a `reconciliation` block:

```json
{
  "reconciliation": {
    "baselineCount": 847,
    "removedViaArchive": 203,
    "removedViaDelete": 51,
    "stillActive": 593,
    "totalAccountedFor": 847,
    "reconciled": true
  }
}
```

Where `totalAccountedFor = stillActive + removedViaArchive + removedViaDelete` MUST equal `baselineCount` when `reconciled = true`.

---

### REQ-6: Immutability Enforcement

#### 6.1 Database-Level Guards

- `ReductionBaseline` rows: once `status` transitions from `ACTIVE` → `FINALIZED`, no column except `status` (to `RESET`) may be updated. Specifically, `totalItemCount`, `itemManifest`, `baselineAt`, and `createdBy` are immutable for the lifetime of the row.
- `ReductionBaseline` rows: when `status = FINALIZED` or `RESET`, `totalItemCount`, `itemManifest`, `finalItemCount`, `baselineAt`, and `finalizedAt` are frozen.
- `ReductionEvent` rows: INSERT only. UPDATE and DELETE are forbidden.
- `ReductionAuditEntry` rows: INSERT only. UPDATE and DELETE are forbidden.

#### 6.2 Application-Level Enforcement

The API layer MUST reject any request that would mutate an immutable field. Errors use HTTP `405 Method Not Allowed` or `409 Conflict` with a descriptive message.

#### 6.3 Integrity Hash (Future-Ready)

The `ReductionBaseline` table MUST include an optional `integrityHash` column (TEXT, nullable). When populated, it contains a SHA-256 hash of:

```
SHA256(initiativeRef || totalItemCount || JSON canonical(itemManifest) || baselineAt)
```

This hash is computed at baseline creation time. It is stored but not actively validated in the initial release. This column exists so that a future audit pass can verify snapshot integrity against tampering without a schema migration.

---

### REQ-7: User Stories & Scenarios

#### US-1: Set Baseline
**As a** Data Steward,
**I want to** capture a baseline snapshot of all in-scope items,
**So that** we have a verifiable starting point for reduction measurement.

**Acceptance scenarios:**
1. Given no active baseline exists, when I invoke "Set Baseline," then a new ACTIVE baseline is created with the current item count and full manifest.
2. Given an ACTIVE baseline already exists, when I invoke "Set Baseline," then the request is rejected with a `409 Conflict` and an audit entry is logged for the attempt.
3. Given a FINALIZED baseline exists, when I invoke "Set Baseline," then the request is rejected unless I first Reset.

#### US-2: Track Item Removal
**As a** Data Steward,
**I want to** log every archive or delete action against the active baseline,
**So that** every removed item is traceable in the audit trail.

**Acceptance scenarios:**
1. Given an ACTIVE baseline exists and the item is in the manifest, when I log an ARCHIVE event, then the event is recorded and returned.
2. Given an ACTIVE baseline exists but the item is NOT in the manifest, when I log an event, then the request is rejected with `400 Bad Request`.
3. Given no ACTIVE baseline exists, when I log an event, then the request is rejected with `409 Conflict`.

#### US-3: Finalize and Compute Reduction
**As a** Program Manager,
**I want to** finalize the reduction effort and see the computed percentage change,
**So that** I can confirm whether the 25% target was met.

**Acceptance scenarios:**
1. Given an ACTIVE baseline with 847 items, 254 items tracked as removed, and the current active count is 593, when I finalize, then `percentageReduction = 29.99%` and `targetMet = true`.
2. Given an ACTIVE baseline with 100 items, 10 items tracked as removed, and the current active count is 90, when I finalize, then `percentageReduction = 10.00%` and `targetMet = false`.
3. Given a FINALIZED baseline, when I attempt to finalize again, then the request is rejected.
4. Given reconciliation fails (an item vanished without an event), when I finalize, then the request is rejected with `RECONCILIATION_FAILED` and the specific discrepancies are listed.

#### US-4: View Verification Report
**As an** Auditor,
**I want to** open the AC-1 verification report,
**So that** I can independently verify the reduction was ≥25% and inspect the removed items.

**Acceptance scenarios:**
1. Given a FINALIZED baseline, when I request the report, then I see baseline count, final count, percentage, target status, and both archived/deleted lists with full details.
2. Given an ACTIVE baseline (not yet finalized), when I request the report, then I see baseline data but no final metrics or target status.
3. Given no baseline exists, when I request the report, then I receive `404 Not Found`.

#### US-5: Export Evidence
**As an** Auditor,
**I want to** export the verification report as CSV or PDF,
**So that** I can attach it to compliance documentation.

**Acceptance scenarios:**
1. Given a FINALIZED baseline, when I export as CSV, then the file contains summary metrics, archived items list, and deleted items list with all columns.
2. Given a FINALIZED baseline, when I export as PDF, then the document preserves the same three sections with a visual target indicator.
3. Given a non-FINALIZED baseline, when I export, then the request is rejected.

#### US-6: Reset Baseline
**As a** Program Manager,
**I want to** reset a baseline with a required reason,
**So that** we can re-baseline if the initial snapshot was incorrect, while preserving the audit trail.

**Acceptance scenarios:**
1. Given an ACTIVE or FINALIZED baseline, when I reset with a reason, then the baseline transitions to RESET and an audit entry is logged.
2. Given I reset without providing a reason, when I submit, then the request is rejected with `400 Bad Request`.
3. Given I am an Auditor (read-only), when I attempt to reset, then the request is rejected with `403 Forbidden`.

---

### REQ-8: Edge Cases & Error Handling

| Scenario | Expected Behavior |
|---|---|
| Baseline count is 0 (no in-scope items) | Baseline is created with `totalItemCount = 0`. Finalization succeeds but `percentageReduction` is `null` (division by zero) and `targetMet = false` with message "No items to reduce." |
| Final count exceeds baseline count | `absoluteReduction` is negative; `percentageReduction` is negative; `targetMet = false`; display message "No reduction achieved — final count exceeds baseline." |
| Same item archived then later deleted | Both events are recorded. The item appears in both the `archivedItems` list and `deletedItems` list (it was archived first, then deleted). The reconciliation counts it once as a removal. |
| Item in baseline is neither archived nor deleted but is still active | The item appears in `stillActive` count; reconciliation passes. |
| Concurrent finalization attempts | The second request sees `status != ACTIVE` and returns `409 Conflict`. |
| Baseline created, zero events logged, then finalized | `absoluteReduction = 0`, `percentageReduction = 0.00%`, `targetMet = false`. Both archived and deleted lists are empty. |
| Item renamed between baseline and event | The event uses the `itemName` at the time of the event (captured in the request), not the baseline name. The baseline manifest preserves the original name. |

---

### REQ-9: Non-Functional Requirements

| NFR | Requirement |
|---|---|
| **NFR-1: Atomicity** | Baseline creation (snapshot + manifest + audit entry) MUST occur in a single database transaction. Finalization (status update + audit entry + reconciliation check) MUST occur in a single transaction. |
| **NFR-2: Append-Only** | `ReductionEvent` and `ReductionAuditEntry` tables MUST reject UPDATE and DELETE operations at the database level (via RLS, trigger, or application guard). |
| **NFR-3: Export Completeness** | CSV and PDF exports MUST include all columns from the lists and all summary metrics. No truncation or pagination of exported data — the full lists MUST render. |
| **NFR-4: Manifest Size** | The system MUST handle `itemManifest` arrays up to 100,000 entries without timeout or error. |
| **NFR-5: Response Time** | Baseline creation and finalization MUST complete within 2 seconds for manifests up to 10,000 items, and within 10 seconds for up to 100,000 items. |
| **NFR-6: Read Performance** | `GET /baseline` (with events) MUST return within 1 second for up to 50,000 events. |
| **NFR-7: Audit Trail Retention** | `ReductionEvent` and `ReductionAuditEntry` rows MUST be retained indefinitely — they are exempt from any standard data retention purge policies. |
| **NFR-8: Idempotency** | Event logging SHOULD be idempotent by `(baselineId, itemId, action)` — logging the same archive event for the same item twice returns the existing event rather than creating a duplicate. |
| **NFR-9: Backward Compatibility** | No existing API routes, database tables, or UI views may be broken by this addition. All changes are additive. |

---

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
