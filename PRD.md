> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #302
> _Each agent that updates this PRD signs its change below._

# PRD: Green Status Indicator — Score Range 75–100 (On Track)

---

## Problem & Goal

**Problem:** Users and downstream systems need a clear, consistent visual and semantic signal when a tracked metric, score, or health check falls within the "on track" range (75–100). Without a standardized definition and implementation, individual teams apply ad-hoc styling and thresholds, creating inconsistency across dashboards, reports, and status surfaces.

**Goal:** Define and implement a single, reusable "Green" status indicator that is reliably rendered, accessible, and semantically correct whenever a numeric score falls between 75 and 100 (inclusive). This becomes the canonical reference for all agents, components, and services that consume or display status signals.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **End Users / Dashboard Viewers** | Instantly understand that a metric is healthy and on track without ambiguity |
| **Product Managers** | Trust that "Green" means the same thing everywhere across all product surfaces |
| **Engineers / Frontend Developers** | Consume a single source of truth for threshold logic and styling tokens |
| **QA / Test Engineers** | Have explicit, testable acceptance criteria for boundary conditions |
| **Data / Analytics Teams** | Rely on a consistent status label when aggregating or reporting status data |

---

## Scope

This PRD covers the **Green tier only** of a multi-tier status indicator system. It defines:

- The numeric threshold that triggers Green status
- The visual representation (color, label, icon)
- The semantic/data representation (string label, enum value)
- Boundary behavior (inclusive edges at 75 and 100)
- Accessibility requirements

---

## Functional Requirements

### FR-1: Threshold Definition
- A score is classified as **Green** if and only if: `75 ≤ score ≤ 100`
- Scores are treated as numeric values (integer or float)
- A score of exactly `75` **is** Green; a score of `74.9` **is not** Green
- A score of exactly `100` **is** Green; a score above `100` is out of range and must not resolve to Green

### FR-2: Visual Indicator
- The indicator color token must resolve to **green** (e.g., `#22C55E` or the design system's canonical `color.status.green`)
- A text label **"On Track"** must accompany the color signal in all non-icon-only contexts
- An optional supporting icon (e.g., a filled circle or checkmark) may be displayed; it must also be green

### FR-3: Semantic / Data Representation
- The status value must be expressible as a machine-readable string: `"green"` (lowercase)
- An enum or constant must be defined: `STATUS.GREEN = "green"`
- Any API response or data payload surfacing this status must include `{ "status": "green", "label": "On Track" }`

### FR-4: Score Display (Optional Companion)
- When the raw score is displayed alongside the indicator, it must be formatted as a whole number or up to one decimal place
- The score display is subordinate to the status label — the status label must always be present if score is shown

### FR-5: Out-of-Range Handling
- If a score is `null`, `undefined`, or `> 100`, the system must **not** render a Green indicator
- Such cases must fall through to a fallback/error state defined by a separate PRD (out of scope here)

### FR-6: Accessibility
- Color alone must not be the only signal; the text label "On Track" is mandatory in all accessible contexts
- The indicator must meet **WCAG 2.1 AA** contrast requirements against its background
- Screen readers must announce: `"Status: Green, On Track"` (or equivalent aria-label)

---

## Acceptance Criteria

| # | Scenario | Input | Expected Result | Pass Condition |
|---|---|---|---|---|
| AC-1 | Lower boundary — inclusive | `score = 75` | Green / On Track | ✅ Green indicator rendered |
| AC-2 | Upper boundary — inclusive | `score = 100` | Green / On Track | ✅ Green indicator rendered |
| AC-3 | Mid-range value | `score = 87.5` | Green / On Track | ✅ Green indicator rendered |
| AC-4 | Just below lower boundary | `score = 74.9` | Not Green | ❌ Green indicator NOT rendered |
| AC-5 | Just above upper boundary | `score = 100.1` | Not Green | ❌ Green indicator NOT rendered |
| AC-6 | Null / undefined score | `score = null` | Not Green | ❌ Green indicator NOT rendered |
| AC-7 | Label presence | `score = 90` | Label visible | ✅ "On Track" text is present in DOM |
| AC-8 | Accessibility — aria-label | `score = 80` | Correct ARIA | ✅ aria-label includes "Green" and "On Track" |
| AC-9 | API payload | `score = 95` | Correct JSON | ✅ `{ "status": "green", "label": "On Track" }` |
| AC-10 | Color token | `score = 75` | Correct color | ✅ Rendered color matches `color.status.green` token |

---

## Out of Scope

- **Yellow / Amber status** (score range TBD, e.g., 50–74) — covered in a separate PRD
- **Red status** (score range TBD, e.g., 0–49) — covered in a separate PRD
- **Score calculation logic** — how a score is computed is upstream of this indicator; this PRD only handles display and classification
- **Trend arrows or delta indicators** (e.g., score moving up or down) — future enhancement
- **Animated or interactive states** (hover, click, tooltip detail expansion) — future enhancement
- **Dark mode color variants** — to be addressed in the design system token PRD
- **Negative scores or scores above 100** — treated as invalid input; error handling is out of scope here
- **Localization / translation of "On Track" label** — i18n pass is a separate workstream