> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #315
> _Each agent that updates this PRD signs its change below._

# PRD: Manual Override of Ingested Data

## Problem & Goal

Automated data ingestion pipelines occasionally produce incorrect, incomplete, or stale records due to source-system errors, mapping failures, or timing gaps. Currently, users have no way to correct these records without either waiting for the next ingestion cycle or requesting engineering intervention. This creates operational bottlenecks, erodes trust in the platform's data, and increases support burden.

**Goal:** Provide authorized users with a self-service mechanism to manually override individual field values on ingested records, with full auditability, without disrupting downstream ingestion pipelines.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Data Stewards** | Correct field-level errors on ingested records daily without engineering help |
| **Operations Analysts** | Fix data that affects live dashboards and reports before the next pipeline run |
| **Compliance Officers** | Ensure records reflect accurate, auditable values for regulatory purposes |
| **Platform Admins** | Manage who can override which data domains and review the override audit log |

---

## Scope

This release covers **field-level manual overrides on existing ingested records** within the platform UI and API. It does not cover bulk re-ingestion, schema changes, or source-system corrections.

---

## Functional Requirements

### FR-1 — Override Entry (UI)
- Users with the `data:override` permission can edit individual field values on an ingested record via the record detail view.
- Editable fields are visually distinguished from read-only system fields.
- The UI displays the current ingested value alongside a text/date/number input appropriate to the field's data type.
- A mandatory **reason** field (free text, max 500 characters) must be completed before saving.

### FR-2 — Override Entry (API)
- A `PATCH /records/{record_id}/overrides` endpoint accepts:
  - `field_name` (string, required)
  - `override_value` (typed, required)
  - `reason` (string, required, max 500 chars)
- The endpoint returns the updated record with override metadata included.
- API authentication follows existing OAuth 2.0 / API-key patterns.

### FR-3 — Override Storage & Data Integrity
- Override values are stored in a dedicated `record_overrides` table, separate from the raw ingested data.
- The original ingested value is never mutated; the override layer is applied at read time.
- If a subsequent ingestion run delivers a new value for the same field, the manual override is **not** automatically cleared — it remains active and continues to take precedence until explicitly removed.

### FR-4 — Override Visibility
- Overridden fields are visually flagged (e.g., icon + tooltip) in all views that surface that record.
- The tooltip/popover shows: original ingested value, current override value, who set it, and when.
- API responses include an `overrides` array on each record object with the same metadata.

### FR-5 — Override Removal
- Users with `data:override` permission can remove an override, reverting the field to the latest ingested value.
- Removal requires a **reason** (free text, max 500 characters).
- Removal is logged as a distinct audit event.

### FR-6 — Audit Log
- Every override creation and removal is written to the platform audit log with:
  - `timestamp`, `actor_user_id`, `record_id`, `field_name`, `previous_value`, `new_value`, `reason`, `action` (`OVERRIDE_SET` | `OVERRIDE_REMOVED`)
- Audit log entries are immutable and retained per the platform's standard retention policy (minimum 2 years).
- Platform Admins can filter the audit log by record, field, user, and date range.

### FR-7 — Permissions & Access Control
- A new permission `data:override` is introduced and assignable at the role level via the existing RBAC system.
- Domain-level restriction: Admins can scope override permissions to specific data domains (e.g., "Finance records only").
- Read-only users see the override indicator but cannot create or remove overrides.

### FR-8 — Notifications
- The record owner (if defined) receives an in-app notification when an override is applied to a record they own.
- Notification includes: field name, new value, actor, and reason.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A user with `data:override` permission can save a field-level override via UI; the overridden value is immediately reflected in the record view. |
| AC-2 | A user without `data:override` permission receives a `403 Forbidden` response when calling `PATCH /records/{record_id}/overrides`. |
| AC-3 | The original ingested value remains unchanged in the raw data store after an override is applied. |
| AC-4 | When a new ingestion run delivers an updated value for an already-overridden field, the override continues to take precedence; no data is lost from either value. |
| AC-5 | Every override creation and removal produces a corresponding immutable audit log entry containing all required fields defined in FR-6. |
| AC-6 | Attempting to save an override without a reason returns a validation error in both UI and API. |
| AC-7 | Overridden fields are visually flagged in the record detail view and in all list/table views that include that field. |
| AC-8 | Removing an override reverts the displayed value to the latest ingested value and logs a `OVERRIDE_REMOVED` audit event. |
| AC-9 | An Admin can restrict a user's override permission to a single data domain; that user cannot override records outside that domain. |
| AC-10 | The `PATCH` endpoint returns HTTP `200` with the full record object (including `overrides` array) on success. |
| AC-11 | Record owner receives an in-app notification within 60 seconds of an override being applied. |
| AC-12 | The audit log search UI returns correct results when filtering by `record_id`, `actor_user_id`, and date range simultaneously. |

---

## Out of Scope

- **Bulk / batch overrides** — overriding many records simultaneously via CSV upload or query.
- **Schema or field-type changes** — overrides must conform to the existing field's data type; type coercion or schema evolution is not addressed here.
- **Source-system writeback** — overrides exist only within the platform; no changes are pushed back to ingestion sources.
- **Automated override suggestions** — ML-driven recommendations for likely corrections.
- **Override versioning / history stacking** — only the most recent active override per field is supported; a full version chain is deferred.
- **Pipeline re-trigger on override** — overrides do not initiate a re-run of downstream transformation jobs.
- **Mobile application support** — override UI is desktop web only in this release.
- **Localization / i18n** — reason fields and audit log entries are English only.