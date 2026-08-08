> **PRD** — drafted by Ada (Sr. Product Mgr) · task #651
> _Each agent that updates this PRD signs its change below._

# PRD: Cross-Project Health Dashboard Component

## Problem & Goal
Project stakeholders lack a single, consistent view of cross-project health, making it difficult to triage risks and blockers across the portfolio. The goal is to deliver a reusable React component (`CrossProjectHealthDashboard`) that displays a concise health card for each project, surfacing status, risk level, the key blocker, and an actionable recommendation.

## Target Users / ICP Roles
- **Program Managers** – need to quickly identify projects that are off-track and understand top issues.
- **Delivery Leads** – triage blockers and assign mitigation actions.
- **Engineering Managers** – review project health and risk signals in their team’s portfolio.

## Scope
- Build a standalone React functional component named `CrossProjectHealthDashboard`.
- Accept a typed array of project health summaries as a prop.
- Render one card per project containing:
  - **Project name** (or identifier)
  - **Overall status** (e.g., On Track, At Risk, Off Track)
  - **Risk level** (Low, Medium, High)
  - **Key blocker** (most critical blocker description)
  - **Recommendation** (action-oriented suggestion)
- Provide a clear TypeScript interface for project data props.
- Apply minimal semantic styling using CSS class names (no external UI library assumptions).

## Functional Requirements
1. **Component API**
   - Export a default component: `CrossProjectHealthDashboard`.
   - Export a TypeScript interface: `ProjectHealth` with fields: `id`, `name`, `status`, `riskLevel`, `keyBlocker`, `recommendation`.
   - Prop `projects: ProjectHealth[]` is required; empty array must render an empty state message.

2. **Visual Representation**
   - Each card displays the `name` as a heading.
   - Status shown with a colour-coded badge (or CSS class): green for On Track, yellow for At Risk, red for Off Track.
   - Risk level as a label with visual distinction (green/yellow/red background mapping to Low/Medium/High).
   - `keyBlocker` rendered as a sentence, truncated with ellipsis if longer than 80 characters (tooltip recommended).
   - `recommendation` appears below the blocker in a lighter type style.

3. **Empty State**
   - When `projects` is empty, render "No projects to display" with appropriate styling.

4. **Edge Cases**
   - Missing or unexpected status/risk values: fall back to "Unknown" with grey styling.
   - `keyBlocker` or `recommendation` may be null/empty string; display "None" or "No recommendation" respectively.

## Acceptance Criteria
- [ ] Component renders without errors when provided a non-empty array of projects.
- [ ] Each card contains: project name, status badge (On Track/At Risk/Off Track with correct color), risk level label (Low/Medium/High with correct color), key blocker text, and recommendation text.
- [ ] Empty `projects` prop renders the empty state message.
- [ ] Status and risk values map to correct CSS classes (e.g., `status--on-track`, `risk--high`).
- [ ] Long blocker text is visually truncated with an ellipsis and full text available via tooltip.
- [ ] Missing status or risk shows "Unknown" and grey styling; missing blocker/recommendation shows fallback text.
- [ ] Export of `ProjectHealth` interface and default component is present.
- [ ] Component file is >= 20 logical lines of source code (excluding blank lines/comments).

## Out of Scope
- Data fetching or state management; component is purely presentational.
- Integration with any specific dashboard framework or page layout.
- Real-time updates, filtering, sorting, or detail drill-down capability.
- Styling beyond basic semantic CSS class names; no pre-defined theme/UI kit assumed.
- Backend API or mock service generation.

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