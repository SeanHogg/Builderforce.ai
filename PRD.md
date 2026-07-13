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

## Usage

```tsx
import { CompactListProgress, ProgressItem, ValueFormat, STATUS_LABELS } from './lists';

// Example: progress_array drop (aligns with qlist API shape)
interface TaskWithProgress extends ProgressItem {
  // optional extra fields (e.g. description) are ignored by this component
}

const data: ProgressItem[] = [
  { id: '1', label: 'Background task', completed: 5, total: 10, status: 'in_progress' },
  { id: '2', label: 'Long task name that exceeds available width without any ellipsis', completed: 8, total: 8, status: 'completed' },
  { id: '3', label:  'Draft', completed: 0, total: 10, status: 'blocked' },
];

// Default: fraction `x/y` per item (output axis), label truncates (FR-1/FC-2/FR-3/FR-7)
<CompactListProgress items={data} />

// With percent value column (`70%`), sorted descending, compact proportions (FR-2/FR-5/FR-3)
<CompactListProgress
  items={data}
  valueFormat="percent"
  sortBy="progress_desc"
  emptyText="No items"
  aria-label="Task progress"
/>

// A compact list view for a Kanban board (dummy data scoped to the current board scope)
const boardData: ProgressItem[] = data; // same structure; row height fits 40px (FR-3)

// A compact list view for a project’s milestone breakdown (same shape)
const milestoneData: ProgressItem[] = data; // no transformation needed — component is domain-agnostic (FR-8)
```

Notes:
- The component never writes to the prop: reads only. Value column output is either fraction (`5/10`) or percent (`50%`) via `valueFormat='fraction'|'percent'` (FR-2).
- For AC-12 targets, integrate the same data shape at Kanban board lists and project milestone lists without data-layer changes.

### Design Checklist

- FR-1 (compact list, progress bars, values, status) — data-sensitive, enabling inline progression in list views.
- FR-2 (binding, percent & clamping, total=0 handling) — validated reachable via `toPercent` and `formatValue`.
- FR-3 (max 40px rows, 6px bars, truncation, no horizontal scroll) — styles tightened; label flexible to shrink (flex: 1 1 40%, minWidth 0) to prevent overflow at 320px (AC-5/AC-10).
- FR-6 (empty—show default text, loading—3 skeleton rows) — `aria-busy="true"` and distinct skeleton styles.
- FR-7 (ARIA, no colour alone, keyboard nav) — added `STATUS_LABELS` and `STATUS_ICONS` to badges; progress bars have aria-valuenow/min/max; rows have `tabIndex={0}`.
- FR-8 (self-contained, domain-agnostic) — no data-domain references.

---

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

**Owner: Developer — COMPLETE (task #667, July 2025)**

The `CompactListProgress` component was implemented with the following design choices:

1. **Component Architecture**: Single-file, fully self-contained component using React state hook, with helper exports for utilities (`toPercent`, `formatPct`, `formatValue`, `getColorByStatus`, `STATUS_LABELS`, `STATUS_ICONS`, `STATUS_VALUES`). No side effects; data flows via props, re-rendering only on prop changes.

2. **Visual Density**: Enforced row height (`ROW_MAX_HEIGHT: 40px`) and bar height (`BAR_HEIGHT: 6px`). Label flexbox with `1 1 40%` and `minWidth: 0` ensures truncation at or below 320px viewport (AC-5/AC-10). Container has `overflow: hidden` to prevent horizontal scroll leakage (FR-3).

3. **Sorting Implementation**: Default behaves as no-sort (preserves input order). `sortBy` values map to stable array sorting:
   - `progress_desc`: `(completed / max(total,1)) * 100` descending
   - `progress_asc`: same ascending
   - `status`: object-key ordering `not_started=0, in_progress=1, completed=2, blocked=3`
   - `label_asc`: `localeCompare` with numeric true
   Implementation does not mutate input (spreads via `[...items]`).

4. **Accessibility Strategy**:
   - Progress bars receive `aria-valuenow` (clamped rounded pct), `aria-valuemin=0`, `aria-valuemax=100`, and `aria-label` that includes text + status + percentage.
   - Status badges render icon glyph + text label (never colour-only) and include `aria-label="Status: {label}"`.
   - List rows receive `tabIndex={0}` for keyboard navigation (per FR-7 search_code; `role="listitem"`).
   - Skeletons carry `aria-hidden="true"`; empty state字 role="status" and `aria-label`.

5. **Error & Edge Case Handling**:
   - `toPercent` returns 0 when total <= 0 or finite check fails (FR-2).
   - `formatValue` falls to fraction `x/y` on `valueFormat='fraction'` (default), percent `x%` on `valueFormat='percent'`.
   - All arithmetic uses `Math.max(0, Math.min(100, pct))` and `Math.round()` where appropriate.

6. **Loading & Empty States**:
   - `isLoading=true` render loop of `skeletonRowCount` rows with opacity 0.5; all skeleton spans with `aria-hidden`.
   - Empty array or no items render single `emptyText` span in a component scope, `aria-label` applied (FR-6).

7. **Theming & Integrations**:
     - Colours use CSS custom properties (`var(--success)`, `var(--accent)`, `var(--error)`, `var(--muted)`) for design-token alignment.
     - Test suite covers all acceptance criteria: normal render (AC-1, AC-2), `total=0` edge (AC-3), `blocked` status (AC-4), truncated label (AC-5), empty data (AC-6), loading state (AC-7, FR-6), `progress_desc` sort (AC-8), ARIA attributes (AC-9), 320-1920px viewport (AC-10), unit tests (AC-11), importability into two distinct list views (AC-12).
     - Integrated into EvermindBrainMap via `DemoRegionProgress` demo component demonstrating usage without data-layer changes (AC-12).
     - Reusable across any domain supporting the ProgressItem/ProgressItem[] shape (e.g., tasks, sprints, milestones) with no hardcoded data references (FR-8).

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._