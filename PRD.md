> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #275
> _Each agent that updates this PRD signs its change below._

# PRD: Guided & Express Input Modes

## Problem & Goal

Users entering data or completing workflows have different levels of familiarity and urgency. Novice users or those working through complex entries need a guided, step-by-step experience that surfaces context and prevents errors. Power users and high-volume operators are slowed down by that same structure — they need to paste, bulk-enter, or fill everything at once and submit in a single action.

**Goal:** Implement two distinct input modes — **Guided** (step-by-step) and **Express** (bulk/single-screen) — that share the same underlying data model, validation logic, and submission pipeline, giving every user the experience that matches their workflow.

---

## Target Users / ICP Roles

| Persona | Preferred Mode | Context |
|---|---|---|
| **New or occasional user** | Guided | Unfamiliar with required fields; needs inline help, progressive disclosure, and error prevention |
| **Power / repeat user** | Express | Knows the schema; wants to paste data, fill a single form, or upload and submit immediately |
| **Data-entry operator** | Express (primary), Guided (fallback) | High throughput; may switch to Guided when entering an unfamiliar record type |
| **Admin / reviewer** | Either | Reviews submissions; may re-open a record in either mode |

---

## Scope

This document covers the frontend input experience and the shared validation/submission layer. It does **not** cover downstream processing of submitted data beyond confirmation.

---

## Functional Requirements

### FR-1 Mode Selection & Persistence
- The UI must present a clear **mode toggle** (e.g., "Step-by-step" / "Express") accessible before and during data entry.
- The selected mode must be persisted per user in their profile/preferences so returning users land in their last-used mode.
- Switching modes mid-entry must preserve all data already entered without loss.

### FR-2 Guided Mode
- **FR-2.1** Divide the input flow into discrete, named steps (e.g., Step 1 of N). Each step contains a logically grouped subset of fields.
- **FR-2.2** Display a visible step indicator (breadcrumb or progress bar) showing current position and total steps.
- **FR-2.3** Validate each step before advancing; surface field-level and step-level error messages inline.
- **FR-2.4** Allow backward navigation to any previously completed step without data loss.
- **FR-2.5** Provide contextual help text, tooltips, or examples on every field.
- **FR-2.6** Show a summary/review screen as the final step before submission, listing all entered values with edit links back to the relevant step.

### FR-3 Express Mode
- **FR-3.1** Present all fields on a single scrollable screen, organized by the same logical groupings used in Guided mode.
- **FR-3.2** Support paste-to-fill: structured text or delimited values pasted into a designated area must auto-populate matching fields.
- **FR-3.3** Support CSV/JSON file upload as an alternative bulk-input mechanism; uploaded data must map to fields and flag unmapped columns.
- **FR-3.4** Run full validation on submit (not field-by-field on blur unless the user opts in via settings).
- **FR-3.5** Display all validation errors in a consolidated error summary at the top of the form, each linking to the offending field.
- **FR-3.6** Allow partial pre-fill via URL query parameters or a saved template so users can load a pre-populated Express form.

### FR-4 Shared Validation & Submission
- **FR-4.1** Both modes must execute identical validation rules drawn from a single validation schema (e.g., Zod, Yup, or server-side equivalent). No mode may bypass a required validation.
- **FR-4.2** Both modes must call the same submission API endpoint with the same payload shape.
- **FR-4.3** On successful submission, both modes must route the user to the same confirmation screen, displaying a summary and next-action options.
- **FR-4.4** On submission failure (network/server error), both modes must preserve entered data and display a retryable error state.

### FR-5 Accessibility
- Both modes must meet WCAG 2.1 AA standards.
- Focus management must be handled correctly on step transitions (Guided) and on error states (both modes).
- The mode toggle must be keyboard-navigable and announced by screen readers.

### FR-6 Analytics & Observability
- Track mode selection, step drop-off rates (Guided), time-to-submit per mode, validation error frequency by field, and mode-switch events.
- Events must be emitted without PII.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A user can select Guided or Express mode before starting input; the choice is saved and restored on next visit. |
| AC-2 | Switching from Guided to Express mid-flow (and vice versa) carries over all previously entered field values. |
| AC-3 | In Guided mode, clicking "Next" on a step with invalid fields prevents advancement and shows inline errors on all failing fields. |
| AC-4 | In Guided mode, the back button returns the user to the previous step with data intact. |
| AC-5 | In Guided mode, the review step displays every entered value and provides working edit links to the originating step. |
| AC-6 | In Express mode, pasting a valid delimited string into the paste target populates all matched fields; unmatched values are flagged. |
| AC-7 | In Express mode, uploading a valid CSV/JSON file populates matched fields; a mapping summary is displayed before confirmation. |
| AC-8 | Submitting an incomplete Express form surfaces a consolidated error list; each item links to and focuses the relevant field. |
| AC-9 | Identical payloads submitted via Guided and Express modes produce identical server responses. |
| AC-10 | Both modes reach the same confirmation screen on success and display the same summary data. |
| AC-11 | All interactive elements in both modes are operable via keyboard alone; screen reader announcements are correct. |
| AC-12 | Mode selection, step transitions, and submission events appear in the analytics pipeline within 5 seconds of occurrence. |

---

## Out of Scope

- **Backend data processing** beyond accepting and acknowledging the submission payload.
- **Multi-user / collaborative editing** of a single in-progress entry.
- **Mobile-native (iOS/Android) app** implementations; this PRD covers web only. Mobile parity is a separate workstream.
- **Offline / service-worker-based** draft saving (auto-save to server is in scope; full offline mode is not).
- **Import from third-party integrations** (e.g., pulling data directly from an external API into the form); file upload covers the bulk-import need for this release.
- **Custom field configuration** by end users; field schema is defined by product/engineering.
- **A/B testing framework** for comparing mode conversion rates; analytics instrumentation (FR-6) enables future testing but the test harness itself is out of scope.