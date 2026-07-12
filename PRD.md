> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #295
> _Each agent that updates this PRD signs its change below._

# PRD: Guided (Interactive) and Bulk (Import) Input Modes

## Problem & Goal

Users need flexibility in how they provide data and configuration inputs to the system. Currently, a single rigid entry point forces all users through the same flow regardless of their context, technical proficiency, or volume of data. Power users and integrators are blocked from automating high-volume operations, while new or occasional users lack structured guidance through complex inputs.

**Goal:** Implement two first-class input modes — a **Guided (Interactive) Mode** for step-by-step assisted entry and a **Bulk (Import) Mode** for high-volume, file-based or programmatic ingestion — so that all user segments can work efficiently within a single product surface.

---

## Target Users / ICP Roles

| Role | Primary Mode | Context |
|---|---|---|
| End User / Operator | Guided | Occasional, low-volume input; benefits from validation prompts and contextual help |
| Power User | Both | Switches between modes depending on task size |
| Data Administrator | Bulk | Manages large datasets; imports from external systems or spreadsheets |
| Developer / Integrator | Bulk | Automates ingestion via file uploads or API-driven import pipelines |
| Product Manager / Analyst | Guided | Creates one-off configurations or reviews inputs interactively |

---

## Scope

### In Scope

- Guided Mode: multi-step interactive form/wizard flow with inline validation, contextual help, and progress indicators
- Bulk Mode: file-based import (CSV, JSON, XLSX) with template download, field mapping, validation summary, and error reporting
- Unified data schema enforced across both modes
- Pre-import preview and dry-run capability in Bulk Mode
- Post-submission confirmation and summary for both modes
- Error handling and recovery paths in both modes
- Mode-selection entry point accessible from the primary action surface

### Out of Scope

- Real-time streaming ingestion or webhook-based input
- API-only bulk endpoints (covered separately in API PRD)
- Automated scheduling or recurring imports
- Machine-learning-assisted field suggestions beyond basic format validation
- Editing or deleting records post-submission (covered by record management PRD)

---

## Functional Requirements

### FR-1 — Mode Selection

- **FR-1.1** The system must present a clear mode-selection step (or toggle) at the entry point, allowing users to choose between Guided and Bulk modes before beginning input.
- **FR-1.2** The selected mode must be persisted for the duration of the session and surfaced in the UI header/breadcrumb.
- **FR-1.3** Users must be able to switch modes before final submission without losing previously entered valid data where a mapping is possible.

---

### FR-2 — Guided (Interactive) Mode

- **FR-2.1** The flow must be broken into discrete, named steps rendered as a linear wizard with a visible progress indicator (e.g., step X of N).
- **FR-2.2** Each step must expose only the fields relevant to that step; users must not be shown the full form at once unless they explicitly request an expanded view.
- **FR-2.3** Inline, real-time field validation must trigger on blur and on attempted step advancement, surfacing human-readable error messages adjacent to the offending field.
- **FR-2.4** Contextual help text or tooltips must be available for every required field and for any field with a non-obvious format requirement.
- **FR-2.5** Users must be able to navigate backward to previous steps without losing data entered in subsequent steps.
- **FR-2.6** A review/summary step must be presented before final submission, displaying all entered values with inline edit links per section.
- **FR-2.7** On successful submission, a confirmation screen must display a unique reference ID and a summary of the created/updated record(s).

---

### FR-3 — Bulk (Import) Mode

- **FR-3.1** The system must provide a downloadable import template in at least CSV and XLSX formats, pre-populated with correct column headers and one example data row.
- **FR-3.2** Users must be able to upload files via drag-and-drop or a file-browser picker; supported formats are CSV, JSON, and XLSX.
- **FR-3.3** Maximum supported file size must be 50 MB; files exceeding this limit must be rejected at upload time with a clear error message.
- **FR-3.4** After upload, the system must display a field-mapping interface allowing users to confirm or adjust the mapping between source columns and target schema fields.
- **FR-3.5** A dry-run (pre-import validation) must execute automatically after field mapping is confirmed, before any data is committed.
- **FR-3.6** The dry-run results must be presented as a structured validation report showing: total rows detected, count of valid rows, count of rows with errors, and a paginated list of row-level errors with column reference and plain-language description.
- **FR-3.7** Users must be able to download an error report (CSV) detailing all failed rows with error reasons.
- **FR-3.8** Users must choose to either (a) import only the valid rows and skip errored rows, or (b) abort the import and fix the source file.
- **FR-3.9** On successful import completion, a confirmation screen must display the total records imported, total skipped, and a downloadable import summary report.
- **FR-3.10** The system must process imports asynchronously for files containing more than 500 rows, providing a progress indicator and notifying the user via in-app notification (and email if configured) when processing completes.

---

### FR-4 — Shared / Cross-Mode Requirements

- **FR-4.1** Both modes must enforce the identical data validation ruleset derived from the canonical data schema.
- **FR-4.2** Both modes must support undo/cancel at any point before final submission, with a confirmation dialog warning of data loss.
- **FR-4.3** All submission events (success and failure) must be logged to the audit trail with user ID, timestamp, mode used, and record count.
- **FR-4.4** Both modes must be fully accessible per WCAG 2.1 AA standards (keyboard navigable, screen-reader compatible, sufficient color contrast).
- **FR-4.5** Both modes must be responsive and usable on viewport widths from 768 px upward.

---

## Acceptance Criteria

| ID | Criterion | Verification Method |
|---|---|---|
| AC-1 | Mode selector is visible on the entry point screen and routes user to the correct flow | Manual / E2E test |
| AC-2 | Guided Mode wizard displays step progress and blocks advancement on validation failure | E2E test |
| AC-3 | All Guided Mode fields surface inline errors within 300 ms of blur | Automated UI test |
| AC-4 | Review step in Guided Mode lists all entered values with functional edit links | Manual / E2E test |
| AC-5 | Bulk Mode accepts CSV, JSON, XLSX; rejects unsupported formats and files > 50 MB with correct error messaging | Automated + manual test |
| AC-6 | Template download produces a file with correct headers and one example row | Automated test |
| AC-7 | Field-mapping interface renders after upload and persists user adjustments | E2E test |
| AC-8 | Dry-run report accurately reflects row-level validation results against a known test fixture | Automated test with fixture data |
| AC-9 | Error report download contains all failed rows with error reasons in CSV format | Automated test |
| AC-10 | Imports > 500 rows are processed asynchronously; user receives in-app notification on completion | Integration test |
| AC-11 | Audit log entry created for every submission attempt (both modes) with required metadata fields | Automated / log assertion test |
| AC-12 | Both modes pass WCAG 2.1 AA audit (zero critical violations) | Automated axe-core scan + manual keyboard test |
| AC-13 | Switching modes before submission retains mappable field data | E2E test |
| AC-14 | Cancelling at any step in either mode does not persist partial data | E2E test |

---

## Out of Scope

- API-only or SDK-driven bulk ingestion endpoints
- Webhook or event-stream based real-time input
- Scheduled or recurring automated imports
- Post-submission record editing (handled by record management module)
- AI/ML-assisted auto-mapping or data enrichment
- Mobile viewports below 768 px width
- Multi-file batch uploads in a single import session
- Localization / i18n beyond English in the initial release