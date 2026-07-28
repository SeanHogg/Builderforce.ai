> **PRD** — drafted by Product Manager · task #528
> _Each agent that updates this PRD signs its change below._

# PRD: Top10AttentionItems Navigation Integration (AC3)

## Problem & Goal
Clicking items in Top10AttentionItems currently performs no navigation despite mock URLs in attentionApi.ts pointing to real routes (/tasks/task-1, /tickets/ticket-1, etc.). The goal is to wire list items to corresponding detail views so users can drill down from the attention list, following the pattern established in DashboardWithAttentionItems.tsx.

## Target users / ICP roles
- Operations managers reviewing high-priority items
- Support agents triaging tickets and tasks
- Project leads monitoring attention items

## Scope
Implement navigation from Top10AttentionItems list items to detail pages. Adjust attentionApi.ts to return page-bound URLs or bind to existing detail routes. Add or wire pages under /tasks/[id], /tickets/[id], and similar patterns as needed. Update components to handle click navigation.

## Functional requirements
- attentionApi.ts returns stable, route-specific URLs for each attention item type
- Top10AttentionItems component renders items as navigable links or buttons
- Clicking an item routes to the corresponding detail view (/tasks/[id], /tickets/[id], etc.)
- Navigation follows the integration pattern from DashboardWithAttentionItems.tsx
- Existing mock data continues to resolve to real routes without breaking

## Acceptance criteria
- Each item in Top10AttentionItems navigates to its matching detail page when clicked
- URLs in attentionApi.ts match implemented routes
- DashboardWithAttentionItems.tsx and any consuming components display working navigation
- No console errors or broken links on click in development and production builds

## Out of scope
- Creating new detail page UI beyond route wiring
- Changes to attention item data models or API contracts
- Styling or UX updates outside navigation behavior
- Backend route implementation or server-side rendering changes

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