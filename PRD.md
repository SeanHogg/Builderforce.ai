> **PRD** — drafted by Ada (Sr. Product Mgr) · task #667
> _Each agent that updates this PRD signs its change below._

# PRD: Compact List Progress Breakdown

## Problem & Goal

Users currently lack a concise, scannable way to view progress breakdowns across items in a list. When working with tasks, projects, or multi-step workflows, the UI does not surface per-item progress in a space-efficient format, forcing users to navigate away or expand verbose views to understand status at a glance.

**Goal:** Implement a compact list component that renders progress breakdowns inline within list views, giving users immediate, at-a-glance visibility into completion status without disrupting the surrounding layout.

---

## Target Users

- **End users / contributors** managing tasks, projects, or multi-step workflows who need quick status awareness
- **Team leads / managers** reviewing progress across multiple items in a dashboard or list view
- **Power users** working in information-dense interfaces who prefer compact, scannable data over expanded cards or modals

---

## Scope

This initiative covers the design and implementation of a reusable compact list progress breakdown component and its integration into existing list views where progress data is available.

---

## Functional Requirements

### FR-1: Compact Progress List Component
- The component must render a vertical list of items, each displaying:
  - Item label / name
  - A visual progress indicator (e.g., slim progress bar or segmented fill)
  - A numeric or percentage value representing current progress (e.g., `7/10` or `70%`)
  - A status badge or color signal (e.g., not started, in progress, completed, blocked)

### FR-2: Progress Data Binding
- The component must accept a structured data prop/input containing:
  - `id` — unique identifier per item
  - `label` — display name of the item
  - `completed` — number of completed units
  - `total` — total number of units
  - `status` — enumerated status value (`not_started`, `in_progress`, `completed`, `blocked`)
- Progress percentage must be calculated as `(completed / total) * 100`, clamped between `0` and `100`
- The component must handle `total = 0` gracefully (display `0%` or `N/A`, no division error)

### FR-3: Visual Density
- Each list row must fit within a maximum height of `40px` (compact mode)
- Progress bar height must not exceed `6px`
- Text must be truncated with ellipsis if the label exceeds the available width
- No horizontal scrolling may be introduced within the list container

### FR-4: Status Color Coding
| Status | Color Token |
|---|---|
| `not_started` | Neutral / gray |
| `in_progress` | Primary / blue |
| `completed` | Success / green |
| `blocked` | Danger / red |

### FR-5: Sorting & Ordering
- The list must preserve the order of items as provided by the data source by default
- An optional `sortBy` prop must support sorting by: `progress_asc`, `progress_desc`, `status`, `label_asc`

### FR-6: Empty & Loading States
- When no items are present, the component must render a non-breaking empty state message (e.g., "No items to display")
- When data is loading, the component must render skeleton placeholder rows matching the expected row height

### FR-7: Accessibility
- Each progress bar must include an `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-label` attribute
- Status badges must not rely solely on color to convey meaning; include a text label or icon with descriptive `aria-label`
- The list must be navigable via keyboard

### FR-8: Reusability
- The component must be self-contained and reusable across any list view in the application that surfaces progress data
- It must not contain hardcoded references to a specific data domain (e.g., tasks, sprints, goals)

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a valid data array, the component renders one row per item with label, progress bar, percentage value, and status badge |
| AC-2 | Given `completed = 5` and `total = 10`, the progress bar fills to 50% and the value displays `5/10` or `50%` |
| AC-3 | Given `total = 0`, the component renders `0%` (or `N/A`) without throwing a runtime error |
| AC-4 | Given an item with status `blocked`, its progress bar and badge render in the danger/red color token |
| AC-5 | Given a label that exceeds available width, the text truncates with an ellipsis and does not overflow its container |
| AC-6 | Given an empty data array, an empty state message is rendered and no list rows appear |
| AC-7 | Given `isLoading = true`, skeleton rows are rendered in place of actual data |
| AC-8 | Given `sortBy = "progress_desc"`, items are ordered from highest to lowest progress percentage |
| AC-9 | Each progress bar element includes correct ARIA attributes reflecting its current value |
| AC-10 | The component renders correctly and without layout breakage at viewport widths from `320px` to `1920px` |
| AC-11 | Unit tests cover: normal render, edge case `total = 0`, empty state, loading state, and sort behavior |
| AC-12 | The component can be imported and rendered in at least two distinct existing list views without modification to those views' data layers |

---

## Out of Scope

- **Editing or updating progress values** from within the compact list component (read-only display only)
- **Drill-down navigation** triggered by clicking a list row (click behavior may be added in a future iteration)
- **Aggregated or rolled-up progress** across nested hierarchies (e.g., parent/child progress trees)
- **Real-time / live-updating** progress via WebSocket or polling (component will re-render when parent re-renders with new data)
- **Filtering** of items within the component itself (filtering is the responsibility of the parent/data layer)
- **Custom theming** beyond the existing design token system
- **Mobile-native** (iOS/Android) implementations; scope is limited to the web UI

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