> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #307
> _Each agent that updates this PRD signs its change below._

# PRD: Trend Arrows (Improving / Stable / Declining)

## Problem & Goal

Users reviewing metrics dashboards currently see static point-in-time values with no immediate visual indication of directional movement. This forces users to mentally compare multiple data points or navigate to historical views to understand whether a metric is getting better, staying the same, or getting worse. The goal is to add inline trend arrows to metric displays that instantly communicate directional momentum, reducing cognitive load and accelerating decision-making.

---

## Target Users / ICP Roles

- **Analysts** — monitor KPI health across multiple metrics simultaneously
- **Managers / Team Leads** — need at-a-glance status during stand-ups and reviews
- **Executives** — scan dashboards quickly for signals requiring attention
- **Product Managers** — track feature and funnel metrics post-release

---

## Scope

This feature covers the calculation, rendering, and accessibility of trend indicators on all numeric metric cards and table cells within the dashboard product. It applies to any metric that has at least two comparable data points within the configured comparison window.

---

## Functional Requirements

### FR-1: Trend Classification

- The system must compare the current period value against the prior period value using the same aggregation method (sum, average, last) already applied to that metric.
- Classify each metric into one of three states:

| State      | Condition                                      | Symbol |
|------------|------------------------------------------------|--------|
| Improving  | Change exceeds the positive threshold          | ↑      |
| Declining  | Change exceeds the negative threshold (in magnitude) | ↓ |
| Stable     | Change falls within the threshold band         | →      |

- Default threshold band: **±2%** relative change. Configurable per metric.

### FR-2: Directionality Polarity

- Each metric must carry a **polarity flag** (`higher-is-better` or `lower-is-better`).
- Arrow color and semantic meaning must respect polarity:
  - `higher-is-better` metric going up → green improving arrow
  - `lower-is-better` metric going up → red declining arrow
  - Stable → neutral gray arrow regardless of polarity

### FR-3: Visual Rendering

- Trend arrow must render inline with the metric value, to the right of the numeric display.
- Arrow sizes must scale with the metric card size (small / medium / large card variants).
- Color palette:
  - Improving: `#22863a` (green)
  - Declining: `#d73a49` (red)
  - Stable: `#6a737d` (gray)
- Arrow icon must use SVG for crisp rendering at all display densities.

### FR-4: Tooltip on Hover / Focus

- Hovering or focusing the arrow must display a tooltip containing:
  - Prior period label and value
  - Current period label and value
  - Absolute change and percentage change
  - Comparison window description (e.g., "vs. previous 7 days")

### FR-5: Comparison Window Configuration

- Supported comparison windows: **period-over-period** (default), **week-over-week**, **month-over-month**, **custom date range vs. custom date range**.
- Users must be able to change the comparison window from the dashboard filter bar; the change applies to all trend arrows on the page simultaneously.
- Metric-level overrides must be possible via metric configuration.

### FR-6: Insufficient Data Handling

- When fewer than two data points exist in the comparison window, display a **dash (—)** in place of an arrow.
- Tooltip for the dash state must read: "Not enough data to calculate trend."

### FR-7: Accessibility

- Each trend arrow must include an `aria-label` describing the state and magnitude, e.g., `"Improving, up 4.2% vs. previous period"`.
- Color must not be the sole differentiator; arrow direction and `aria-label` must carry the meaning independently.
- Keyboard focus must trigger the same tooltip as hover.

### FR-8: Data Freshness

- Trend calculations must use the same data snapshot as the surrounding metric card; no separate async fetch for trend data.
- Trend arrow must update reactively when the dashboard date range or comparison window changes.

---

## Acceptance Criteria

| ID   | Criterion |
|------|-----------|
| AC-1 | Given a metric with current value 105 and prior value 100 (higher-is-better, 2% threshold), the arrow renders green ↑ with aria-label containing "Improving". |
| AC-2 | Given a metric with current value 101 and prior value 100 (any polarity, 2% threshold), the arrow renders gray → with aria-label containing "Stable". |
| AC-3 | Given an error-rate metric (lower-is-better) with current value 110 and prior value 100 (exceeds threshold), the arrow renders red ↑ (up arrow, declining color) with aria-label containing "Declining". |
| AC-4 | Hovering the arrow displays a tooltip with prior value, current value, absolute delta, percentage delta, and comparison window label. |
| AC-5 | A metric with only one data point in the comparison window displays — and the tooltip reads "Not enough data to calculate trend." |
| AC-6 | Changing the comparison window in the filter bar updates all trend arrows on the page within one render cycle without a full page reload. |
| AC-7 | Trend arrows pass WCAG 2.1 AA contrast requirements for all three color states against both light and dark dashboard backgrounds. |
| AC-8 | Trend arrows are keyboard-focusable and the tooltip appears on focus, confirmed via automated accessibility test. |
| AC-9 | The threshold band is configurable per metric and persists across sessions. |
| AC-10 | All arrow SVGs render without blur or pixelation at 1×, 1.5×, and 2× device pixel ratios. |

---

## Out of Scope

- Sparklines or mini-charts embedded in metric cards (separate initiative)
- Anomaly detection or statistical significance scoring
- Trend arrows in exported PDF / CSV reports (future iteration)
- Predictive / forecast arrows indicating future trend
- Push notifications or alerts triggered by trend state changes
- Mobile-native (iOS / Android) implementations — web responsive only in this release
- Metric creation or polarity configuration UI — polarity flag must be set via existing metric definition tooling