> **PRD** — drafted by CTO · task #487
> _Each agent that updates this PRD signs its change below._

# Evermind Knowledge & Learning Pipeline PRD

## Problem & Goal
Teams building memory-enabled agents lack a repeatable pipeline to baseline existing knowledge, extract new insights, review for quality, store durably, and transfer to downstream systems. The goal is to deliver a reliable, auditable pipeline that turns raw interactions into structured, transferable knowledge while minimizing hallucination and drift.

## Target Users / ICP Roles
- Memory-engine maintainers and platform engineers
- AI application developers integrating long-term memory
- Knowledge operations roles responsible for review and governance

## Scope
Implement the five-stage pipeline (baseline → extract → review → store → transfer) as a core workflow inside `memory-engine`. Cover orchestration, data models, review interfaces, and transfer adapters for the initial release.

## Functional Requirements
- **Baseline**: Snapshot current knowledge graph and vector store state with versioning.
- **Extract**: Identify and pull candidate facts, entities, and relationships from new sessions or documents.
- **Review**: Human-in-the-loop or automated quality gates for accuracy, relevance, and conflict detection.
- **Store**: Persist reviewed items into the canonical knowledge store with provenance metadata.
- **Transfer**: Export approved knowledge to external targets (vector DBs, graphs, downstream agents) via configurable adapters.
- Provide CLI and SDK entry points for pipeline execution and status tracking.
- Log every stage transition for auditability.

## Acceptance Criteria
- Pipeline completes an end-to-end run on a 100-session corpus with <5% manual intervention.
- Baseline and store operations produce immutable snapshots retrievable by version.
- Review step surfaces conflicts and requires explicit approval before storage.
- Transfer adapters successfully sync to at least two target systems with zero data loss.
- All stages expose metrics (latency, items processed, rejection rate) via Prometheus.

## Out of Scope
- Advanced LLM fine-tuning or model training
- Real-time streaming ingestion
- Multi-tenant isolation or billing features
- Mobile or non-engine client SDKs
- Historical data migration from legacy systems

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — implementation authored below (task #275, PR #166)._

### Task #275 — Guided & Express Input Modes (frontend)

**Why PRD.md conflicted.** When PR #166 branched off `main` the file `PRD.md` held the Diagnostic Report PRD (task #157). The branch replaced the entire file with the Task #275 "Guided & Express Input Modes" PRD. Meanwhile `main` advanced by 238 commits and the same file now holds the Evermind Knowledge & Learning Pipeline PRD (CTO, task #487). This role therefore resolves the merge conflict per Manager instruction: preserve main's PRD verbatim and record the input-mode implementation in the `Implementation Notes` section that main's template already reserves for the developer.

#### Shared library — `frontend/src/lib/inputMode.ts`

Single source of truth for validation and for both input modes (FR-4.1 / FR-4.2). Exports:

- Types: `InputMode`, `FieldDefinition`, `FieldGroup`, `FormSchema`, `ValidationError`, `InputModeEvent`.
- Mode persistence (FR-1 / AC-1): `getStoredInputMode` / `setStoredInputMode` — `localStorage.bf_input_mode`, restored on next visit.
- Validation: `validateField`, `validateGroup`, `validateAll` — identical rules for both modes, no bypass path.
- Paste-to-fill (FR-3.2 / AC-6): `parseDelimitedPaste` supports `key: value`, `key=value`, `key<TAB>value`, and CSV `header+row` formats; returns `{ values, unmatched, warnings }`.
- File upload (FR-3.3 / AC-7): `parseCsvUpload`, `parseJsonUpload` — maps columns/keys to schema fields, surfaces unmapped columns for a mapping-summary UI.
- Analytics (FR-6 / AC-12): `markFormStart`, `trackInputModeEvent` via `tracker.ts` — mode_select, step_transition, mode_switch, paste_fill, file_upload, submit with `elapsedMs`; no PII.
- Template & prefill (FR-3.6): `buildInitialValues`, `listSavedTemplates`, `saveTemplate`, `deleteTemplate`, `loadTemplate`, `parseQueryPrefill`, `coercePayload` — saved templates and URL query-parameter pre-fill, type-coerced against the schema.

Analytics wiring uses the existing `frontend/src/lib/activity/tracker.ts:trackActivity` — verified to exist at branch time via `search_code` — so events flow into the same pipeline the rest of the portal uses.

#### Mode container — `frontend/src/components/InputModeForm.tsx`

Client component orchestrating Guided vs Express. Responsibilities:

- Reads / writes preferred mode to `localStorage` (FR-1).
- Initializes field values via `buildInitialValues` or `initialValues` prop (supports template / query-param pre-fill, FR-3.6).
- Preserves all entered values when switching modes (FR-1 / AC-2) via `switchToGuided` / `switchToExpress` callbacks.
- Both modes call the same `wrappedSubmit` → `onSubmit` → `onSuccess` chain (FR-4.2 / FR-4.3 / AC-9 / AC-10).
- Screen-reader live region announces mode transitions (FR-5 / AC-11).
- Mode selection tracked on mount (FR-6).

#### Guided mode — `frontend/src/components/GuidedInput.tsx`

- Step indicator (breadcrumb / progress bar) showing current step and total (FR-2.2).
- One `FieldGroup` per step (FR-2.1), with contextual help text, tooltips, examples on every field (FR-2.5).
- Forward validation — `validateGroup` on "Next"; blocks advancement and shows inline errors on failing fields (FR-2.3 / AC-3).
- Backward navigation via back button with data intact (FR-2.4 / AC-4) and ability to jump to any previously completed step.
- Summary/review final step listing all entered values with edit links back to originating step (FR-2.6 / AC-5).
- Keyboard navigable, focus managed on step transitions, WCAG 2.1 AA (FR-5).

#### Express mode — `frontend/src/components/ExpressInput.tsx`

- Single scrollable screen with all fields, same `FieldGroup` groupings as Guided (FR-3.1).
- Paste target: `parseDelimitedPaste` → auto-populate matched fields, flag unmatched values (FR-3.2 / AC-6).
- File upload: CSV / JSON → `parseCsvUpload` / `parseJsonUpload` → matched fields with a mapping-summary UI surfacing unmapped columns (FR-3.3 / AC-7).
- Validation on submit (FR-3.4), not field-by-field on blur unless user opts in; consolidated error summary at top, each item linking to and focusing its field (FR-3.5 / AC-8).
- Partial pre-fill via URL query params / saved templates (FR-3.6).
- On submission failure, preserves entered data and displays retryable error (FR-4.4).

#### Shared validation & submission (FR-4)

- Same schema (`FormSchema`), same validation module (`inputMode.ts`), same endpoint payload shape (FR-4.1 / FR-4.2).
- Both reach the same confirmation screen with the same summary data on success (FR-4.3 / AC-10).
- Submission failure path preserves data and surfaces retry (FR-4.4).
- `InputModeForm.wrappedSubmit` ensures identical `onSubmit` / `onSuccess` pipeline so AC-9 and AC-10 hold.

#### Accessibility (FR-5)

- Keyboard operable: mode toggle, step nav, paste area, file upload, error summary links, edit links.
- Focus: managed on Guided step transitions and on error focus after failed submit in both modes.
- Screen reader: live region on mode switch, properly announced roles/labels; WCAG 2.1 AA.

#### Tests — `frontend/src/lib/inputMode.test.ts`

`vitest` suites covering:

- `validateField` / `validateGroup` / `validateAll` — required, email, url, number (min/max), text (min/max length), date, pattern, blank optional, mixed validity.
- `parseDelimitedPaste` — `key: value`, `key=value`, `key<TAB>value`, CSV `header+row`, unmatched detection, empty paste warning.
- `parseCsvUpload` / `parseJsonUpload` — mapped vs unmapped, invalid JSON, non-object JSON, flat-object happy path.
- Persistence — `getStoredInputMode` / `setStoredInputMode` with SSR guard.
- Templates — save / list / load / delete, overwrite by name.
- Multi-step-ness — schema groups invariant across Guided and Express.

#### Task #275 — original Guided & Express Input Modes PRD (preserved for traceability)

The original PRD that this work was authored against is preserved inline below so review and audit retain its acceptance criteria.

---

### Task #275 Original PRD — Guided & Express Input Modes

_Product goal: two input experiences sharing the same validation, submission, analytics._

**Target users:**
- New/occasional → Guided (step-by-step, inline help).
- Power/repeat + data-entry operator → Express (single-screen, paste, CSV/JSON upload).
- Admin/reviewer → either.

**FR-1 Mode selection & persistence**
- Mode toggle visible before and during entry.
- Selected mode persisted per-user in localStorage so returning user lands in last-used mode.
- Switching modes mid-entry preserves already-entered data.

**FR-2 Guided**
- Divide into discrete named steps, progress indicator.
- Validate per-step before advancing, inline errors.
- Back to any completed step, no data loss.
- Contextual help on every field.
- Summary/review final step with edit links.

**FR-3 Express**
- Single scrollable form, same groupings.
- Paste-to-fill (delimited → fields), flag unmatched.
- CSV/JSON upload, map → fields, flag unmapped columns.
- Full validation on submit; consolidated error summary linking to fields.
- Partial pre-fill via URL query params / saved template.

**FR-4 Shared validation & submission**
- Both modes same validation rules drawn from `inputMode.ts`.
- Both call same endpoint / payload shape (AC-9).
- Same confirmation screen (AC-10).
- Failure preserves data and offers retry.

**FR-5 Accessibility — WCAG 2.1 AA, keyboard, focus mgmt, screen-reader announcements.**

**FR-6 Analytics — mode selection, step drop-off (Guided), time-to-submit per mode, validation error freq by field, mode-switch events, all without PII (AC-12).**

**Acceptance Criteria AC-1…AC-12** are laid out in the task #275 description (see ticket). AC-1 persistence, AC-2 mid-flow switch preservation, AC-3 inline step validation, AC-4 back nav, AC-5 review+edit links, AC-6 paste, AC-7 file upload mapping summary, AC-8 consolidated error list with focus links, AC-9 identical payload response, AC-10 same confirmation screen, AC-11 keyboard+screen-reader, AC-12 analytics within 5 s — mapped above to implementation.

#### Submission API binding

Per task #350 resolution (mutable engine, IDE-coupled persistence) and per `frontend/src/lib/inputMode.ts` convention, final payload is whatever the hosting page's `onSubmit` callback posts — this keeps `FormSchema.endpoint` decoupled from the actual API route (Next.js proxy / Cloudflare worker) and prevents IDE-`engine` constant / IDE-`ide_agents.engine` column re-introductions that task #278 previously got wrong. Validation, assignment, and payload-shape assertions are enforced client-side before the POST; server-side schema and DB binding remain project-owned.

#### Lessons from Task #278 revert

- Never clobber `api/src/infrastructure/database/schema.ts` barrel with an import of a file that does not exist.
- `api/**` uses Hono (Cloudflare Workers), not `express+zod`; do not introduce `express` or `db` import from the barrel.
- This branch deliberately stays frontend-only — no migrations under `api/`, no `api/` schema changes — to avoid repeating that revert.

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
