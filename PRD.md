> **PRD** — drafted by Validator · task #706
> _Each agent that updates this PRD signs its change below._

# WIP PRD: progressPct=100 Emission Rule & Documentation Alignment

## Problem & Goal
Current progress-handling guidance and supporting docs lack explicit rules for emitting `progressPct=100`, direct listener cleanup patterns, and warnings against 99/99.9 approximations. Duplicates exist in the PRD and schema references are outdated.  
Goal: enforce a single canonical emission rule at exactly 100, provide clear cleanup guidance, remove doc drift, and keep schema/CHANGELOG in sync with FR-1..FR-5.

## Target users / ICP roles
- SDK integrators implementing progress listeners  
- Documentation maintainers and schema consumers  
- Product engineers validating event payloads

## Scope
- Update `docs/guides/progress-handling.md` with direct listener-cleanup on `progressPct=100` and warning for 99/99.9 values  
- Remove duplicate content and correct schema reference in PRD.md  
- Confirm `docs/api/event-payload.schema.json` and `docs/CHANGELOG.md` already align with FR-1..FR-5  
- No behavioral changes to emitters or schema

## Functional requirements
- FR-1: Emit `progressPct=100` exactly once to signal completion  
- FR-2: Immediately remove listeners after `progressPct=100` receipt  
- FR-3: Warn when values 99 or 99.9 are used near completion  
- FR-4: PRD references only the canonical schema file  
- FR-5: CHANGELOG records the above rule and cleanup pattern

## Acceptance criteria
- `progress-handling.md` contains the cleanup pattern and 99/99.9 warning  
- PRD.md is free of duplicates and points to the canonical schema  
- Schema and CHANGELOG remain unchanged and consistent with FR-1..FR-5  
- All four files pass markdown/schema linting

## Out of scope
- New schema fields or emitter logic changes  
- Implementation of the rule in source code  
- Backwards compatibility guarantees beyond existing FR-1..FR-5

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