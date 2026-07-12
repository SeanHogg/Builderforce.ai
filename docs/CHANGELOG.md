# CHANGELOG

All notable changes to the documentation for this project will be documented in this file.

## [Unreleased]

### Documentation

- **Progress tracking guidance and schema updates** — Clarify that `progressPct: 100` is the canonical terminal emission per resource (job or task); include it at most once and only after all processing steps complete. Add explicit constraints and examples to the canonical schema in `docs/api/event-payload.schema.json`. Provide correct listener-cleanup patterns in `docs/guides/progress-handling.md`. Warn against treating intermediate values such as 99 or 99.9 as completion equivalents. Include this notable change in this changelog to document the behavior and guiding integrators on what to verify or adjust when speaking to the progress API.

### Version support

Unreleased changes apply to all current-* and future-* branches unless otherwise noted.