> **PRD** — drafted by Ada (Sr. Product Mgr) · task #893
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Backlog Stale‑Flagging

## Problem & Goal
Backlog items that remain untouched for an extended period often go unnoticed, cluttering the board and wasting team focus. Currently there is no automated indication of which items have not been updated in over 90 days. The goal is to introduce a visible **stale flag** that is automatically applied to any backlog item with no updates for >90 days, enabling teams to quickly identify and triage stagnant work.

## Target Users / ICP Roles
- Product Managers, Scrum Masters, Engineering Leads – anyone responsible for backlog hygiene and prioritization decisions. They need an at-a-glance signal to act on aging items.

## Scope
**In scope**  
- Automatic detection of items whose `lastModified` timestamp exceeds 90 days.  
- Storage of a persistent boolean stale flag on the backlog item entity.  
- Exposure of the stale flag through existing API responses.  
- Visual indicator (badge/icon) in the `ManagerContent` UI for flagged items.  

**Out of scope**  
- Automated actions on stale items (auto‑close, deletion).  
- User‑configurable time threshold or project‑specific overrides.  
- UI controls for manual marking/unmarking or for filtering/sorting by stale status.  
- Notifications, alerts, or reporting dashboards.  
- Historical tracking of when the flag was set or cleared.

## Functional Requirements
1. **FR‑1 – Automatic Flagging**  
   The system must evaluate whether a backlog item’s `lastModified` is older than 90 days and set a `stale` boolean field to `true` when that condition holds.

2. **FR‑2 – Persistent Storage**  
   A `stale` field (boolean, default `false`) must be added to the backlog item data model. Its value is persisted and returned in API responses.

3. **FR‑3 – Flag Computation**  
   The stale flag must be up‑to‑date whenever a backlog item is fetched individually or in a list. This may be achieved by computing the flag on each read or periodically via a background job.

4. **FR‑4 – Visual Indicator**  
   The `ManagerContent` list view must display a distinct visual indicator (e.g., a “Stale” label or icon) adjacent to any item where `stale === true`.

5. **FR‑5 – Flag Reset on Update**  
   Any successful update to a backlog item (any field) must cause the stale flag to revert to `false` (either synchronously on save or on the next read), because the item is no longer untouched beyond 90 days.

## Acceptance Criteria
- **AC‑1** – Given an item whose `lastModified` is >90 days in the past, when the backlog list is loaded, the item displays the stale indicator.
- **AC‑2** – Given an item whose `lastModified` is ≤90 days, no stale indicator is shown.
- **AC‑3** – When an item is edited and saved (e.g., changing title/description), its stale flag becomes `false` and the indicator disappears (immediately or on next list refresh).
- **AC‑4** – The `stale` field is present and correctly `true`/`false` in the API responses for both the single‑item GET and the list GET endpoints.
- **AC‑5** – Introducing the stale flag does not degrade UI load times; performance remains acceptable under normal load.

## Out of Scope
- Manual override of the stale flag.  
- Automatic closing, archiving, or deletion of stale items.  
- Customisable staleness duration (hard‑coded to 90 days).  
- Notifications or reminders for stale items.  
- Filtering, sorting, or grouping by stale status in the UI.  
- Historical audit of flag changes.  
- Per‑team or per‑project configuration.  
- Dashboard metrics or reports based on the stale flag.

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