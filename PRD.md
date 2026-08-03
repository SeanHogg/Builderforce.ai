> **PRD** — drafted by Ada (Sr. Product Mgr) · task #881
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Ownership Assignment for AC-6 Compliance

## Problem & Goal
Active items in the system currently have an assigned owner/DRI count of zero, violating internal compliance control AC-6 (Least Privilege and Accountability). No owner or DRI documentation exists for any active item, resulting in a critical accountability gap. The goal is to ensure every active item has exactly one assigned owner/DRI at all times, enabling traceability, audit readiness, and adherence to AC-6.

## Target users / ICP roles
- **Compliance Officers** – need to verify and attest that all active items meet ownership requirements.
- **Security Administrators** – require tooling to detect and remediate unassigned items.
- **System/Application Owners** – responsible for assigning and maintaining item ownership.
- **Auditors** – consume ownership assignment logs and reports during assessments.

## Scope
- Detection and reporting of active items lacking an assigned owner/DRI.
- Enforcement mechanisms to prevent the creation or activation of an item without an owner.
- Interfaces for manual assignment, bulk assignment, and audit trail review.
- Real-time notifications when the count of unassigned items is non-zero.
- Integration with the corporate identity provider (IdP) to validate owner/DRI identifiers.

## Functional requirements
1. **Unassigned Item Detection**
   - The system shall continuously identify all items with `status = active` and `assigned_owner IS NULL`.
   - The system shall maintain a real-time count of such items visible to authorized users.
2. **Assignment Dashboard**
   - Provide a dedicated view listing all unassigned items with metadata (item type, ID, creation date, last modified).
   - Allow filtering and sorting by item attributes.
3. **Manual & Bulk Assignment**
   - Authorized users (Security Admin, Compliance Officer) can assign an owner/DRI to a single item or multiple items in bulk.
   - The owner/DRI field must be a valid, active identity from the corporate IdP; invalid entries shall be rejected with an actionable error message.
4. **Create/Activation Guard**
   - Any API or UI operation that would result in a new active item or change an item’s status to `active` shall require a non-null owner/DRI field.
   - The operation shall fail with a clear error if the owner is not specified, blocking the item from entering an active state.
5. **Alerts & Notifications**
   - When the unassigned active item count transitions from zero to greater than zero, the system shall send an alert (in-app, email) to a configurable distribution list (Compliance Officers, Security Admins).
   - A daily summary notification shall be sent while unassigned items persist.
6. **Audit Logging**
   - Every assignment, reassignment, and bulk operation shall create an immutable log entry capturing: timestamp, actor, item ID, previous owner (if any), new owner, and change reason where provided.
   - Logs must be searchable and exportable for audit purposes.

## Acceptance criteria
- **AC1:** For any active item with no owner, the item appears on the unassigned items dashboard with correct details.
- **AC2:** When a compliance officer navigates to the dashboard, they see a non-zero count badge and can click through to the detailed list.
- **AC3:** Creating a new item without an owner via API or UI returns HTTP 422 / a user-facing error, and the item is not saved as active.
- **AC4:** Selecting multiple unassigned items and performing a bulk assignment with a valid owner clears all from the list and logs each assignment.
- **AC5:** At the moment the unassigned count goes from 0 to 1, an alert email is sent to the pre-configured distribution list.
- **AC6:** The audit trail for a specific item includes all owner changes with accurate before/after values and timestamps.

## Out of scope
- Automated rule‑based assignment (e.g., inherit from parent resource).
- Re‑assignment triggered by employee departure or role change (future workflow).
- Integration with external ITSM tools for ownership dispute management.
- Historical SLA reporting on unassigned item duration beyond the standard audit log retention period.

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