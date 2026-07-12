> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #276
> _Each agent that updates this PRD signs its change below._

# PRD: Structured Health Profile Persistence

## Problem & Goal

Users complete health-related questionnaires or intake flows within the application, but their answers are currently ephemeral — lost between sessions or inaccessible to downstream features and collaborators. The goal is to automatically capture, structure, and persist those answers as a canonical **Health Profile** artifact attached to the relevant project, so the data is durable, reusable, and machine-readable.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **End User / Patient** | Answers are saved and do not need to be re-entered; can review and update their profile at any time. |
| **Clinician / Care Team Member** | Can view a structured, consistent health profile for any project they have access to. |
| **Developer / Integrating System** | Can read the health profile via a stable API to power downstream features (recommendations, risk scoring, etc.). |
| **Project Admin** | Can manage who has read/write access to a project's health profile. |

---

## Scope

This document covers the **first stable version (v1)** of Health Profile persistence. It addresses:

- Capturing answers from an existing questionnaire/intake UI flow
- Transforming raw answers into a defined structured schema
- Attaching the structured profile to a project entity
- Providing read and update access to the stored profile
- Basic versioning to track changes over time

---

## Functional Requirements

### FR-1 — Answer Capture
- The system must intercept the final submission event of any health questionnaire flow.
- All answered fields, including optional ones left blank, must be captured with their question identifiers and response values.
- Capture must be idempotent: re-submitting the same answers must not create duplicate records.

### FR-2 — Structured Schema Transformation
- Raw answers must be mapped to a canonical **HealthProfile** schema before persistence.
- The schema must include at minimum:

  ```json
  {
    "profileId": "uuid",
    "projectId": "uuid",
    "schemaVersion": "1.0",
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601",
    "demographics": { ... },
    "medicalHistory": { ... },
    "currentSymptoms": { ... },
    "medications": [ ... ],
    "lifestyle": { ... },
    "customFields": { ... }
  }
  ```

- Unknown or unmapped question keys must be stored in `customFields` without being dropped.
- The schema version must be recorded on every saved profile.

### FR-3 — Project Attachment
- Each project may have exactly **one active Health Profile**.
- The Health Profile must be retrievable via the project's identifier (foreign key relationship).
- Deleting a project must cascade-delete its associated Health Profile (or archive it, per data-retention policy).

### FR-4 — Versioning & Audit Trail
- Every save or update must create an immutable snapshot (version record) with a timestamp and the identity of the actor who triggered the change.
- The most recent version is the **active profile**; all prior versions must be queryable.
- Version records must be retained for a minimum of 90 days.

### FR-5 — Read & Update API
- `GET /projects/{projectId}/health-profile` — returns the active Health Profile.
- `PUT /projects/{projectId}/health-profile` — creates or fully replaces the active profile; previous version is snapshotted automatically.
- `PATCH /projects/{projectId}/health-profile` — partially updates specified fields; previous version is snapshotted automatically.
- `GET /projects/{projectId}/health-profile/versions` — returns a paginated list of historical versions.
- `GET /projects/{projectId}/health-profile/versions/{versionId}` — returns a specific historical snapshot.
- All endpoints must enforce project-level authorization.

### FR-6 — Access Control
- Only users with **project read** permission may call `GET` endpoints.
- Only users with **project write** permission may call `PUT` / `PATCH` endpoints.
- Service-to-service access must use scoped API tokens.

### FR-7 — Data Integrity & Validation
- The system must validate all incoming payloads against the canonical schema before persistence.
- Validation errors must return HTTP 422 with a structured error body identifying each offending field.
- PII fields (name, date of birth, contact details) must be encrypted at rest.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Submitting a completed health questionnaire results in a Health Profile being persisted and associated with the correct project within 2 seconds of submission. |
| AC-2 | Re-submitting identical answers to the same project does not create a duplicate profile; the existing record is updated and a version snapshot is created. |
| AC-3 | `GET /projects/{projectId}/health-profile` returns the active profile in ≤ 300 ms (p95) under normal load. |
| AC-4 | All fields answered in the questionnaire appear in the returned Health Profile, either in their canonical section or in `customFields`. No answers are silently dropped. |
| AC-5 | A user without project access receives HTTP 403 on all Health Profile endpoints. |
| AC-6 | After three sequential updates, `GET /projects/{projectId}/health-profile/versions` returns exactly three historical version records plus the current active state. |
| AC-7 | Submitting a payload with an invalid field type returns HTTP 422 with a body that names the offending field(s). |
| AC-8 | PII fields are confirmed encrypted at rest via a storage-layer inspection check in the QA environment. |
| AC-9 | Deleting a project results in its Health Profile being archived (or deleted) and no longer returned by the API. |
| AC-10 | The `schemaVersion` field on every stored profile matches the current canonical schema version at the time of creation. |

---

## Out of Scope

- **Multi-profile per project** — a project holds exactly one active Health Profile in v1; multiple-profile support is a future consideration.
- **FHIR / HL7 export** — structured export to external health record standards is a separate workstream.
- **Real-time sync / webhooks** — event streaming on profile changes is not included in v1.
- **UI for viewing/editing the Health Profile directly** — v1 covers persistence and API only; a dedicated profile management UI is a follow-on task.
- **Consent management** — recording and enforcing patient consent for data use is handled by a separate Consent service.
- **De-identification / anonymization pipelines** — out of scope for v1; handled by the data platform team.
- **Offline / conflict-resolution sync** — client-side offline capture and merge logic is not in scope.