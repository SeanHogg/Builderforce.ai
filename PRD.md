> **PRD** — drafted by Ada (Sr. Product Mgr) · task #824
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Duplicate entries in the system lead to:
- Confusion among users
- Inaccurate data analysis
- Increased storage costs
- Potential errors in business processes

### Goal
Ensure that the system effectively identifies and removes duplicate entries, maintaining data integrity and improving user experience.

## Target Users / ICP Roles

- **Data Analysts**: Require accurate and clean data for reporting and analysis.
- **Customer Support Representatives**: Need to access correct customer information to provide effective support.
- **System Administrators**: Responsible for maintaining system health and performance.
- **End Users**: Expect a seamless and error-free experience when interacting with the system.

## Scope

- **Detection**: Implement a mechanism to detect duplicate entries based on predefined criteria.
- **Notification**: Notify relevant stakeholders when duplicates are detected.
- **Removal**: Provide functionality to remove duplicate entries automatically or manually.
- **Prevention**: Implement measures to prevent future duplicate entries.

## Functional Requirements

1. **Duplicate Detection**
   - System must identify duplicates based on unique identifiers (e.g., email, user ID) and/or combination of fields (e.g., name and phone number).
   - Detection should be configurable to allow for different criteria based on data type and use case.

2. **Notification System**
   - Send alerts to administrators and relevant users when duplicates are detected.
   - Include details of the duplicate entries, such as the fields that matched and the number of duplicates found.

3. **Removal Functionality**
   - Provide options to remove duplicates automatically based on predefined rules (e.g., keep the most recent entry).
   - Allow manual review and removal of duplicates through a user interface.
   - Ensure that removal actions are logged for auditing purposes.

4. **Prevention Measures**
   - Implement real-time validation to prevent the creation of new duplicate entries.
   - Provide feedback to users during data entry if a potential duplicate is detected.

5. **Reporting**
   - Generate reports on the number of duplicates detected and removed over time.
   - Include metrics on the effectiveness of duplicate prevention measures.

## Acceptance Criteria

- **Detection**: System correctly identifies duplicates based on specified criteria with a 99% accuracy rate.
- **Notification**: Notifications are sent within 5 minutes of duplicate detection.
- **Removal**: 
  - Automatic removal processes complete within 1 hour.
  - Manual removal actions are completed by users without errors.
- **Prevention**: No new duplicates are created after implementation, verified through testing.
- **Reporting**: Reports are generated accurately and are accessible through the admin dashboard.

## Out of Scope

- **Historical Data Cleanup**: Addressing duplicates in historical data prior to the implementation of this feature.
- **Third-Party Integrations**: Handling duplicates that originate from third-party systems or integrations.
- **Complex Data Relationships**: Managing duplicates in data with complex relationships or hierarchies.
- **User Training**: Developing training materials or conducting training sessions for users on the new duplicate management features.
- **Advanced Analytics**: Incorporating machine learning or advanced analytics for predictive duplicate detection.

## Requirements

### 1. Removal Capability — As-Built

`TicketParticipantsService.removeParticipant(env, tenantId, taskId, participantId)` already exists in
`api/src/application/kanban/ticketParticipants.ts`. It deletes from `ticket_participants` matching
**all** of `tenantId`, `taskId`, `id = participantId`, **and `source IN ('assessment','manual')`**,
then bumps the manifest cache version.

**BA finding — two constraints that determine whether verification can pass:**

- **F-1 — `template`-sourced rows cannot be removed.** The `inArray(source, ['assessment','manual'])`
  predicate means a duplicate whose provenance is `template` (or `lane_agent`) matches zero rows.
  Re-deriving the manifest re-inserts template slots idempotently, so a template duplicate is
  *by design* not removable — it must be corrected at the `swimlane_requirements` template instead.
- **F-2 — the delete is silent.** It returns `void` and does not report the affected row count, so a
  no-op delete is indistinguishable from a successful one by the caller. Verification therefore
  **must not** trust the call's return; it must re-read the manifest (§3).

**Requirement:** removal is considered *specified* by the as-built method. No new tool is required for
an `assessment`/`manual` duplicate. If Epic #709's participant `0d6423f1-…` is `template`-sourced,
this ticket's verification will legitimately FAIL and the fix belongs in the board template — that
outcome is a valid, reportable result, not a defect in this verification.

### 2. Duplicate Detection Criteria

A **duplicate participant** is defined as two or more rows in `ticket_participants` sharing
identical values for the slot tuple: `(taskId, stageKey, roleKey, responsibility, source)`.

This tuple is the conflict target used by both `deriveManifest` and `addParticipant`
(`onConflictDoUpdate`), which is why repeated derivation is idempotent.

**BA finding F-3 — NULL `stageKey` defeats the uniqueness guarantee.** `stageKey` is nullable, and in
Postgres `NULL` is never equal to `NULL` under a plain unique index. Two rows that both have
`stage_key IS NULL` and are otherwise identical therefore do **not** conflict, and `ON CONFLICT` does
not fire — so the very duplicate this epic is trying to clean up can be inserted repeatedly. Unless
the index is declared `NULLS NOT DISTINCT` (PG15+) or backed by a partial/`COALESCE` expression index,
"the duplicate is gone" is **not a stable state**: a later `addParticipant`/`deriveManifest` can
recreate it. This is the root cause worth fixing and is captured as a follow-up ticket rather than
being silently assumed away.

**Example from Epic #709:**
- Row A: `roleKey='engineer'`, `stageKey='development'`, `source='assessment'` (participantId: `0d6423f1-ff54-40fc-9e0a-082956af913f`)
- Row B: `roleKey='engineer'`, `stageKey=NULL`, `source='template'`
- Rows A and B are NOT duplicates (different stageKey + source), but two rows with identical `(stageKey, roleKey, responsibility, source)` are.

### 3. Verification Criteria

"The duplicate entry is gone" is verified when **all** of the following hold. Each check is stated so
it fails loudly rather than passing by default — a silent no-op delete (F-2) must not read as success.

1. **Row absent.** `SELECT id FROM ticket_participants WHERE task_id = 709 AND id =
   '0d6423f1-ff54-40fc-9e0a-082956af913f'` returns **zero rows**.

2. **Manifest absent.** Re-reading the manifest for task 709 (`kanban.participants`, served by
   `TicketParticipantsService.listParticipants`) returns no participant with that `id`. This read must
   happen **after** the cache-version bump; the manifest is cached under `participants:task:709`, so a
   read taken from a stale cache version is not evidence.

3. **Surviving Engineer slot.** Exactly one `roleKey='engineer'` slot remains for task 709, and it is
   **not** `unstaffed` — i.e. removing the duplicate did not delete the coverage along with it.

4. **Idempotence / no resurrection (guards F-3).** After running `deriveManifest` once more, check 1
   still holds and no new `roleKey='engineer'` row has appeared with `stage_key IS NULL`. If the
   duplicate reappears, the verification FAILS and F-3 is confirmed as the root cause.

**Pre-condition on the evidence.** Checks 1–4 must be executed against the live workspace. During this
run both `kanban.participants` and `kanban.accountability` for task 709 returned
`401 Token has been revoked or expired`, so the verification could **not** be executed here. The
criteria above are therefore delivered as the *specification* of the check; the execution is tracked
separately (see Traceability) and this ticket must not be reported as "verified" on their basis alone.

### 4. Traceability

| ID | Requirement | Verification | Status |
|----|-------------|--------------|--------|
| REQ-824-1 | Removal deletes the row identified by `participantId` | §3 check 1 | Specified — not executed (401) |
| REQ-824-2 | Manifest read after removal reflects the deletion (post cache bump) | §3 check 2 | Specified — not executed (401) |
| REQ-824-3 | Duplicate is defined by the slot tuple `(taskId, stageKey, roleKey, responsibility, source)` | Conflict target in `deriveManifest` / `addParticipant` | Confirmed in code |
| REQ-824-4 | Removing the duplicate leaves Engineer covered and not `unstaffed` | §3 check 3 | Specified — not executed (401) |
| REQ-824-5 | Removal is durable across a re-derive | §3 check 4 | Specified — blocked by F-3 |
| F-1 | `template`/`lane_agent` rows are not removable by `removeParticipant` | Code: `inArray(source, ['assessment','manual'])` | Confirmed in code |
| F-2 | Removal returns `void`; a no-op delete is indistinguishable from success | Code: `removeParticipant` signature | Confirmed in code |
| F-3 | NULL `stageKey` means duplicate slots do not conflict in Postgres | Nullable `stage_key` in unique tuple | Confirmed in code — follow-up filed |

### Open items for the executing role

1. Re-run §3 checks 1–4 with valid credentials; record actual results as Test Evidence.
2. Determine the `source` of participant `0d6423f1-…`. If `template`, this ticket cannot pass as
   scoped (F-1) and the fix moves to the board's `swimlane_requirements`.
3. Resolve F-3 before treating any removal as permanent.

---

**Authored by:** Business Analyst (task #824)  
**PRD owner:** Ada (Sr. Product Mgr)

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._