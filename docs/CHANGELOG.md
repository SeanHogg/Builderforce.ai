# Builderforce.ai Changelog

All notable changes to this project will be documented in this file.

(Changelog entries are tools-agent-authored and factual by nature; they DO NOT imply test passing.)

## [2026.7.82] - 2026-01-XX

### Added

**Documentation: progressPct=100 emission rule (#672)**
- Added `docs/api/event-payload.schema.json` with JSON Schema for progress event payloads, including the canonical contract that `progressPct=100` MUST be emitted only once, after ALL processing steps are confirmed complete and NO further progress updates will follow.
- Added `docs/guides/progress-handling.md` with integration guide and code examples showing how to:
  - Register a progress listener that terminates upon receiving `progressPct=100`
  - Avoid treating intermediate values (e.g., 99) as equivalent to completion
  - Properly clean up listeners when the task completes
  - Log and surface business events based on the authoritative 100% signal
- Added `docs/progress-docs-checklist.md` to verify that all progress-related documentation is consistent and complete across the codebase.

### Changed

**API contracts: progress event semantics**
- Clarified that `progressPct=100` is emitted only after all processing steps are complete (never redundant)
- Documented ordering guarantee: 100 is the terminal signal with no subsequent values
- Updated field descriptions to distinguish `progressPct=100` from other terminal status fields (e.g., `status: "completed"`)

---

For a full list of prior releases, see [CHANGELOG.md](v07/index.html).