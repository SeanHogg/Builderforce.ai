> **PRD** — drafted by Product Manager · task #524
> _Each agent that updates this PRD signs its change below._

# builtin_brain_list PRD

## Problem & Goal
Current chat retrieval lacks a dedicated, project-scoped endpoint that returns only chats where the authenticated user is owner or message participant. Goal is to deliver GET /api/brain/chats/list that returns ordered chat IDs, enforces projectId validation, and surfaces machine-readable validity plus cause strings instead of generic errors.

## Target users / ICP roles
- Backend engineers integrating chat listing into project workspaces
- Frontend clients consuming chat lists for authenticated users

## Scope
- New endpoint GET /api/brain/chats/list
- Query parameter handling, Prisma query with projectId filter + createdAt ASC ordering
- Response shape { chats: string[] } or { valid: false, cause: string }
- Registration of endpoint and chats.json schema per governance
- Addition of at least one exercising test case

## Functional requirements
- Accepts projectId as required query parameter
- Returns { chats: string[] } when valid
- Filters results to chats where current user is owner or participant in any message
- Orders by createdAt ascending
- Returns { valid: false, cause: string } for missing projectId, non-integer value, prohibited value, or zero matches
- Uses prismaClient and implements accepted algorithm (add where.projectId, orderBy.createdAt('asc'))

## Acceptance criteria
1. Product architecture and backend APIs aligned with FRs
2. Endpoint and chats.json schema registered according to governance
3. Test suite includes at least one test case exercising the endpoint
4. Valid requests produce boolean valid:true and chat list; invalid requests produce valid:false with plain cause string

## Out of scope
- Search, archive, deletion, or integrations

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