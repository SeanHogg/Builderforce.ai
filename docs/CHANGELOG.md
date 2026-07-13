# Changelog

All notable changes to this project (new feature, fixes, breaking changes, behavioral rule clarifications) will be documented in this file.

## [Unreleased]

### Behavioral Rule Clarifications — 2025-06-17
- Clarified the canonical `progressPct=100` emission rule across API reference (`docs/api/event-payload.schema.json`) and developer guide (`docs/guides/progress-handling.md`).;
    - Rule statement: `progressPct=100` is the authoritative terminal signal for progress-stream consumers.
    - Conditions: emitted at most once per job/task, ONLY AFTER all processing steps complete, with no further progress events following;
    - Integrity check: conjunction of `progressPct===100` and `status:"completed"` is recommended to confirm terminal completion.
  - Previous ambiguity: prior descriptions conflated immediate proximity to completion (e.g., 99) with the actual terminal emission, risking premature UI state updates and missed teardown.
  - Integration impact: developers should verify that progress listeners terminate on `progressPct===100` and not rely on intermediate values as completion indicators.
  - Documentation coverage: API reference (`progressPct` field description), developer guide (canonical rule subsection and full listener-cleanup example), and changelog entry are now consistent and complete.

### Added — 2025-06-17
- Clarified the canonical `progressPct=100` emission rule across API reference (`docs/api/event-payload.schema.json`) and developer guide (`docs/guides/progress-handling.md`). The rule states:
  - `progressPct=100` is the authoritative terminal signal for progress-stream consumers.
  - Emitted at most once per job/task, and ONLY AFTER all processing steps complete, with no further progress events following.
- Updated API reference `progressPct` field description to explicitly reflect the ordering guarantee and `status` correlation requirement.
- Enhanced developer guide Canonical Rule subsection and added a complete Python example that registers a progress listener, corrects its cleanup on `progressPct==100`, and highlights the danger of treating 99 (or any non-100 intermediate) as completion.
- Added dated changelog entry to `docs/CHANGELOG.md` describing this Behavioral Rule Clarification.