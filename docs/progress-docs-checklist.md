# Progress Documentation Checklist

This checklist helps technical writers and reviewers ensure that all progress-related documentation accurately reflects the `progressPct=100` emission rule.

## General Principles

1. Consistent terminology
   - All documents MUST use the same meaning for `progressPct=100` emissions.
   - Avoid contradictions across pages.

## Validation Checks

In-scope assets:

- API reference (`docs/api/event-payload.schema.json`, etc.)
- Developer guides (`docs/guides/progress-handling.md`, etc.)
- Changelog (`docs/CHANGELOG.md`)
- Inline code comments/JSDoc/TSDoc
- README sections covering progress tracking

Reviewers must verify:

- AC - Locate the canonical `progressPct=100` rule within 60 seconds of opening the API reference without prior knowledge of the change.
  - [ ] A reviewer can locate the canonical `progressPct=100` rule within 60 seconds of opening the API reference without prior knowledge of the change.
- AC - No contradicting or misleading language.
  - [ ] No documentation page retains language implying `progressPct=100` may be emitted before task completion or may be emitted redundantly (unless explicitly stating this is the rule).
- AC - Example payload with `progressPct: 100`.
  - [ ] The API reference contains at least one complete example JSON/payload showing `"progressPct": 100`.
- AC - Developer guide code example correctly registers and cleans up on `progressPct=100`.
  - [ ] The developer guide's progress-handling example:
    - Registers a progress listener.
    - Treats intermediate values (e.g., 99) as non-final.
    - Provides a cleanup action upon receiving `progressPct=100`.
- AC - Changelog entry exists.
  - [ ] A dated changelog entry exists and accurately describes the rule change or clarification.
- AC - No contradictory descriptions across all in-scope docs.
  - [ ] A full-text search for `progressPct` across all in-scope documentation reveals no contradictory statements about the `=100` emission condition.

## Approval Process

- Each modified document must be approved by at least one peer reviewer (engineer or technical writer).
- Each approval must address at least one validation check above.
- Include the reviewer’s name or alias on the approval.