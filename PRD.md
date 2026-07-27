> **PRD** — drafted by Validator · task #867
> _Each agent that updates this PRD signs its change below._

# Problem & Goal
Capabilities management currently lacks inline editing, deletion, and validated creation flows, forcing users through navigation or incomplete UIs. The goal is to deliver full CRUD (create via modal, inline title/status edits, delete with confirmation) with immediate local-state feedback, form validation, and typed API serialization across listed components.

# Target users / ICP roles
Product managers, capability owners, and engineering leads at Builderforce.ai who maintain capability backlogs.

# Scope
- Implement listing, inline edit (title/status), add modal, and delete flows in CapabilitiesList.tsx
- Build validated form modal in AddCapabilityModal.tsx (title, description, category, status, priority, tags)
- Add confirmation dialog in DeleteConfirmation.tsx with error handling
- Extend capabilitiesApi.ts for typed GET/POST/PATCH/DELETE (204 support)
- Enforce validation using VALID_STATUSES; immediate PATCH state updates; hover feedback
- Files limited to the four paths listed

# Functional requirements
- FR-1: CapabilitiesList renders list with add button wiring to modal
- FR-2: Inline title/status editing via blur/Enter/Escape with pre-submit validation
- FR-3: AddCapabilityModal supports required title, optional fields, chip-based tags (max 10), and valid status/category enforcement
- FR-4: DeleteConfirmation displays cleanup dialog and propagates API errors
- FR-5: capabilitiesApi provides full typed CRUD methods including 204 DELETE handling

# Acceptance criteria
- AC-1: Empty title or invalid status blocks submission
- AC-2: Only VALID_STATUSES and accepted categories pass validation
- AC-3: Tags accept up to 10 entries via Enter key
- AC-4: Inline edits commit on blur/Enter and cancel on Escape
- AC-5: PATCH responses trigger immediate local-state update (AC-8)
- AC-6: Success/error messages shown via hover tooltips
- AC-7: API calls are typed and handle 204 responses without errors
- AC-8: No navigation entries or external links added

# Out of scope
Navigation entries, routing changes, or any files beyond the four specified.

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

## Acceptance

_Owned by the validator — to be authored._