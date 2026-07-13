# Changelog

All notable changes to this project (new feature, fixes, breaking changes, behavioral rule clarifications) will be documented in this file.

## [Unreleased]

### Behavioral Rule Clarifications — 2025-06-17
- Clarified the canonical `progressPct=100` emission rule across API reference (`docs/api/event-payload.schema.json`) and developer guide (`docs/guides/progress-handling.md`). The rule states:
  - `progressPct=100` is the authoritative terminal signal for progress-stream consumers.
  - Emission rule: at most once per job/task, emitted only after all processing steps complete.
  - Ordering guarantee: no further progress updates follow it.
  - Developers should check `progressPct===100` and `status===completed` together to confirm terminal completion.
- Previous ambiguity: prior descriptions conflated immediate proximity to completion (e.g., 99) with the actual terminal emission, risking premature UI state updates and missed teardown.
- Integration impact: developers are expected to verify that progress listeners terminate on `progressPct===100` and not rely on intermediate values as completion indicators.
- Documentation coverage: API reference (`progressPct` field description), developer guide (canonical rule heading, complete listener-cleanup pattern example), and the changelog entry are now consistent. Inline JSDoc in `api/src/application/brain/ChatTicketService.ts` and TSDoc in `packages/brain-ui/src/chatTickets/types.ts` reflect the same semantics for backend/frontend consumers (not duplicated here to preserve a single source of truth).