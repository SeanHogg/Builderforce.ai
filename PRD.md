> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #293
> _Each agent that updates this PRD signs its change below._

# PRD: Conditional Logic for Adaptive Questions

## Problem & Goal

Static question flows present every respondent with the same set of questions regardless of their previous answers. This creates poor user experiences — irrelevant questions frustrate respondents, inflate completion time, and reduce data quality. The goal is to implement conditional logic that dynamically shows, hides, or branches questions based on prior answers, producing a personalized, relevant question flow for each respondent.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Form / Survey Builders** | Configure conditional rules without writing code |
| **End Respondents** | Experience a concise, relevant question flow |
| **Analysts / Data Owners** | Receive clean, logically consistent response data |
| **Developers / Integrators** | Access a well-defined rule schema for programmatic form creation |

---

## Scope

This document covers the definition, configuration, evaluation, and rendering of conditional logic rules within the question flow engine. It applies to all question types supported by the platform.

---

## Functional Requirements

### FR-1 — Rule Definition
- A builder must be able to attach one or more conditional rules to any question or question group.
- Each rule must specify:
  - **Trigger source**: the question(s) whose answer drives the condition.
  - **Operator**: equality, inequality, contains, does not contain, greater than, less than, is empty, is not empty, matches regex.
  - **Trigger value**: the value(s) to compare against (static literal or reference to another answer).
  - **Action**: `show`, `hide`, `skip to`, `require`, `set value`.
- Rules must support **multiple conditions** combined with `AND` / `OR` logical operators.
- Rules must support **nested condition groups** (e.g., `(A AND B) OR C`).

### FR-2 — Supported Question Types
Conditional logic must work as both trigger source and target for:
- Single-choice (radio, dropdown)
- Multi-choice (checkbox)
- Short text / Long text
- Number / Slider
- Date / Date-range
- Rating / NPS
- File upload (trigger: is empty / is not empty only)
- Matrix / Grid

### FR-3 — Rule Evaluation Engine
- Rules must be evaluated **in real time** as the respondent answers each question (client-side evaluation for latency < 100 ms).
- Server-side re-evaluation must occur at submission to prevent manipulation.
- Evaluation order must follow **question sequence order** to avoid circular dependency conflicts.
- Circular dependency detection must run at **save time**; the builder must be blocked from saving a form with circular rules and shown a clear error.

### FR-4 — Question Visibility & Flow
- Hidden questions must not be reachable via keyboard navigation or assistive technology.
- Hidden questions must **not** be included in submission payloads unless they hold a pre-filled default value explicitly marked for submission.
- When a `skip to` action fires, all intermediate questions must be marked as skipped (not hidden) and excluded from required-field validation.
- If a previously shown question becomes hidden due to a changed answer, its answer must be **cleared** unless the builder has enabled the "retain hidden answer" option.

### FR-5 — Builder UI
- Condition rules must be configurable via a visual rule builder (no code required).
- The builder must provide a **plain-language summary** of each rule (e.g., *"Show this question if Q3 answer is 'Yes'"*).
- The builder must offer a **live preview mode** where the builder can simulate different answer values and observe the resulting question flow.
- Conflicting or redundant rules must surface a **non-blocking warning** in the builder UI.

### FR-6 — Rule Storage & Schema
- Rules must be stored as a **JSON schema** attached to each question object.
- The schema must be versioned to support backward-compatible migrations.
- Rules must be exportable and importable alongside the form definition.

### FR-7 — Progress & Completion Indicators
- Progress bars / step counters must dynamically reflect only the questions that will be shown based on current answers, not the total question count.
- The estimated completion time indicator (if present) must update dynamically.

### FR-8 — Accessibility
- Show/hide transitions must respect `prefers-reduced-motion`.
- Screen readers must announce when a new question becomes visible.
- Focus must move automatically to the first newly revealed question.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | A builder can create a rule that hides Question B when Question A equals a specific value, and the rule is saved and persists across sessions. |
| AC-2 | During form fill, Question B disappears within 100 ms after the triggering answer is entered for Question A. |
| AC-3 | A hidden question's answer is cleared from the submission payload (unless "retain hidden answer" is enabled). |
| AC-4 | Server-side re-evaluation at submission rejects or flags any response set that violates defined conditional rules. |
| AC-5 | The builder cannot save a form containing a circular dependency; an error message identifies the conflicting questions. |
| AC-6 | Live preview mode correctly simulates all configured conditional paths without requiring form publication. |
| AC-7 | Progress indicator updates dynamically and never counts questions that will not be shown given current answers. |
| AC-8 | `AND` / `OR` compound conditions with at least two levels of nesting evaluate correctly in automated test suite (≥ 50 test cases). |
| AC-9 | A `skip to` action causes all skipped intermediate questions to pass required-field validation without error. |
| AC-10 | Screen reader announces newly revealed questions; verified with VoiceOver (macOS) and NVDA (Windows). |
| AC-11 | Rules export with the form definition and re-import with identical behavior on a clean instance. |
| AC-12 | All conditional logic evaluates correctly on the latest two versions of Chrome, Firefox, Safari, and Edge. |

---

## Out of Scope

- **AI/ML-driven adaptive questioning** (dynamically generated rules based on response patterns — future phase).
- **Cross-form conditional logic** (rules that reference answers from a different form or prior form session).
- **Time-based or geolocation-based conditions** (e.g., show question only between certain hours or in certain regions).
- **A/B testing or randomization** of question paths.
- **Offline / service-worker caching** of conditional rule evaluation.
- **Legacy form migration tooling** to automatically convert existing static forms to conditional logic (separate migration project).
- **Pricing or quota enforcement** tied to conditional logic feature tiers (handled by billing team).