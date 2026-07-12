> **PRD** — drafted by Ada (Sr. Product Mgr) · task #672
> _Each agent that updates this PRD signs its change below._

# PRD: Update Documentation for `progressPct=100` Emission Rule

## Problem & Goal

A new rule has been introduced governing when and how `progressPct=100` is emitted during task/job processing. Existing documentation does not reflect this rule, creating a risk of developer confusion, incorrect integrations, and inconsistent behavior across consumers of the progress API. The goal is to revise all relevant documentation so that the `progressPct=100` emission semantics are accurately, completely, and consistently described.

---

## Target Users / ICP Roles

| Role | Concern |
|---|---|
| **API Integrators / SDK Consumers** | Need accurate event contracts to build reliable progress indicators |
| **Internal Backend Engineers** | Need to understand emission rules when modifying job/task processing pipelines |
| **Frontend / Client Engineers** | Need correct expectations about when 100% signals true completion |
| **QA / Test Engineers** | Need acceptance criteria to validate correct emission behavior |
| **Technical Writers** | Primary executors of documentation changes |

---

## Scope

All documentation assets that describe progress event emission, task/job lifecycle, or the `progressPct` field, including:

- API reference pages covering the progress event or job status payload
- Developer guides / integration tutorials that walk through progress handling
- Changelog / migration guide entries
- Inline code comments or JSDoc/TSDoc annotations directly describing `progressPct` behavior
- Any README sections covering progress tracking

---

## Functional Requirements

### FR-1 — Canonical Rule Statement
The documentation MUST include a dedicated, clearly labeled explanation of the `progressPct=100` emission rule, stating:
- The exact conditions under which `progressPct=100` is emitted
- Whether `progressPct=100` is emitted once or can be emitted multiple times
- The ordering guarantee: `progressPct=100` MUST only be emitted after all processing steps are confirmed complete and no further progress updates will follow
- That `progressPct=100` is the authoritative signal of task/job completion for progress-stream consumers

### FR-2 — API Reference Update
The API reference for the progress event payload MUST:
- Update the `progressPct` field description to document the `=100` boundary condition explicitly
- Note any distinction between `progressPct=100` and other terminal status fields (e.g., `status: "completed"`) if applicable
- Include a concrete example payload showing `progressPct=100`

### FR-3 — Developer Guide Update
Any integration guide or tutorial covering progress handling MUST:
- Revise code examples or pseudocode to correctly handle the `progressPct=100` event as a completion signal
- Warn against treating intermediate values near 100 (e.g., 99) as equivalent to 100
- Describe the correct pattern for tearing down progress listeners upon receiving `progressPct=100`

### FR-4 — Changelog / Migration Entry
A changelog entry MUST be added that:
- Identifies this as a behavioral rule clarification or change (whichever is accurate)
- States the previous behavior or ambiguity that existed before
- Describes what developers must verify or update in their integrations

### FR-5 — Consistency Across All Assets
All documentation assets in scope MUST use consistent terminology and MUST NOT contain contradictory statements about `progressPct=100` semantics.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A reviewer can locate the canonical `progressPct=100` rule within 60 seconds of opening the API reference without prior knowledge of the change. |
| AC-2 | No documentation page within scope retains language that implies `progressPct=100` may be emitted before task completion or may be emitted redundantly, unless such behavior is explicitly the new rule. |
| AC-3 | The API reference contains at least one complete JSON/payload example that includes `"progressPct": 100`. |
| AC-4 | The developer guide's progress-handling code example correctly registers and cleans up a listener that terminates on `progressPct=100`. |
| AC-5 | A changelog entry exists, is dated, and accurately describes the rule change or clarification. |
| AC-6 | A full-text search for `progressPct` across all in-scope documentation surfaces no contradictory descriptions of the `=100` emission condition. |
| AC-7 | At least one peer reviewer (engineer or technical writer) has approved each modified document. |

---

## Out of Scope

- Changes to source code implementing the `progressPct=100` emission logic (covered by the engineering task that introduced the rule)
- Documentation for `progressPct` values other than `100` unless directly necessary for contextual clarity
- New features or changes to the progress API beyond documenting the existing new rule
- Localization or translation of updated documentation
- Documentation for deprecated or sunset versions of the API that are no longer actively maintained

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