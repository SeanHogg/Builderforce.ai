> **PRD** — drafted by Ada (Sr. Product Mgr) · task #886
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Backlog Stale Item Identification

## Problem & Goal
**Problem:** Backlog items that remain untouched for more than 90 days accumulate silently, leading to invisible technical debt, forgotten tasks, and degraded backlog hygiene. Currently, no mechanism exists to automatically detect, flag, or surface these stale items.

**Goal:** Implement an automated system that identifies items untouched for >90 days, persists a stale flag on each item, and exposes this flag in the UI so teams can triage aging backlog items proactively.

## Target Users / ICP Roles
- **Product Managers:** Need visibility into neglected items to prioritize or deprecate them.
- **Engineering Leads:** Use stale indicators to drive backlog grooming sessions.
- **Scrum Masters / Agile Coaches:** Monitor backlog health metrics.
- **Individual Contributors:** Require clear signals that an item may need re-evaluation before picking it up.

## Scope
This feature covers:
- Definition of a configurable stale threshold (default 90 days).
- A persistent `stale` boolean flag on backlog item records.
- An automated background process that scans items daily and sets the flag when an item’s `last_updated` timestamp exceeds the threshold.
- UI indicators to surface stale items in list views and item detail panels.
- An admin setting to adjust the threshold value.

## Functional Requirements

### FR-1: Configurable Stale Threshold
The system shall support a configurable threshold value (in days) at the system or workspace level, defaulting to 90 days.

### FR-2: Persistent Stale Flag
Each backlog item record shall include a `stale` boolean field (default `false`). The flag shall be updated to `true` when the item’s age exceeds the threshold and reset to `false` when the item is modified.

### FR-3: Automated Staleness Scan
A background service (scheduled job or cron) shall execute at least once per day. It shall query all items where `last_updated` is older than `NOW() - threshold` and `stale = false`, then set `stale = true`. Conversely, when an item is updated (any field change), the `stale` flag shall be immediately recalculated and set to `false`.

### FR-4: UI Indicator – List View
Backlog list views (board, table, or kanban) shall display a visual indicator (e.g., an icon, badge, or text label) next to any item where `stale = true`.

### FR-5: UI Indicator – Detail View
The item detail panel shall display a prominent warning or tag when the item is stale, including the number of days since last update.

### FR-6: Threshold Administration
An authorized administrator shall be able to configure the stale threshold via a settings interface. Changing the threshold shall trigger a one-time re-evaluation of all items within a reasonable time window (e.g., next scan cycle).

## Acceptance Criteria

### AC-1: Stale Flag Applied Correctly
- **Given** a backlog item with `last_updated` timestamp exactly 91 days ago and a stale threshold of 90 days  
- **When** the daily stale scan executes  
- **Then** the item’s `stale` field is set to `true`.

### AC-2: Recent Activity Resets Flag
- **Given** an item with `stale = true`  
- **When** any update is made to the item (e.g., comment, status change, description edit)  
- **Then** `stale` is immediately set to `false` and `last_updated` reflects the modification time.

### AC-3: UI Indicator Visible in List
- **Given** a backlog view containing at least one item with `stale = true`  
- **When** a user loads the view  
- **Then** each stale item displays a recognizable stale indicator (icon or badge).

### AC-4: Detail Panel Warning
- **Given** a user opens the detail panel for a stale item  
- **When** the panel renders  
- **Then** a visible message displays “This item has been inactive for X days” where X matches the elapsed time since `last_updated`.

### AC-5: Threshold Configuration Persists
- **Given** an admin changes the stale threshold from 90 to 60 days  
- **When** the next scan cycle runs  
- **Then** items untouched for >60 days are flagged, and items between 61-90 days (previously not stale) now become stale.

### AC-6: No False Positives After Update
- **Given** a stale item is modified, setting `stale = false`  
- **When** the next scan runs before another 90 days pass  
- **Then** the item remains `stale = false`.

## Out of Scope
- Automatic archival or deletion of stale items beyond flagging.
- Customizable workflows or automations triggered by the stale flag (e.g., auto-assigning for review).
- Notification generation for stale items (email, Slack, etc.) — this may be addressed in a future notification feature.
- Staleness reporting dashboards or analytics.
- Per-project or per-team threshold overrides (initial release supports a single global or workspace-level threshold).
- Staleness based on criteria other than `last_updated` (e.g., no comments, no linked PRs).

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