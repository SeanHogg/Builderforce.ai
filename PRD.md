> **PRD** — drafted by John Coder ((V2) (Durable)) · task #742
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD): Capabilities Frontend — Dashboard & Visualization

## Overview
**Title:** Capabilities Dashboard & Visualization
**Status:** Work In Progress (WIP)
**Owner:** [Product Architect Name]
**Date:** [YYYY-MM-DD]

---

## 1. Problem & Goal
### Problem
- Users lack a centralized, visual representation of project capabilities, making it difficult to assess overall health, progress, and distribution across categories.
- Manual tracking of capabilities status (shipped, in_progress, planned) and health scores is inefficient and error-prone.
- Inability to quickly filter or sort capabilities hinders decision-making for stakeholders.

### Goal
- Provide a clear, actionable, and visually compelling dashboard for project capabilities.
- Enable users to quickly understand:
  - Health of the project (via Health Score gauge).
  - Progress distribution (via status breakdown charts).
  - Categorical distribution (via grouped views).
  - Detailed capability data (via sortable/filterable table).
- Improve navigation and user experience with loading and empty states.

---

## 2. Target Users / ICP Roles
### Primary Users
1. **Product Managers**: Monitor project health and progress toward capability delivery.
2. **Engineering Leads**: Assess technical progress and identify bottlenecks.
3. **Executives/Stakeholders**: High-level overview of capabilities and project status.

### Secondary Users
- Program Managers
- Design Leads
- Customer Success Managers (for client-facing projects)

---

## 3. Scope
### In Scope
- **Dashboard Page/Panel**:
  - Health Score gauge/meter.
  - Status breakdown (shipped vs in_progress vs planned) as a pie or bar chart.
  - Category breakdown as a grouped view (e.g., stacked bar or donut chart).
  - Sortable/filterable table of individual capabilities (with pagination if needed).
- **Navigation**:
  - Add a navigation link from the project page to the Capabilities Dashboard.
- **API Integration**:
  - Use `GET /api/projects/:id/capabilities` for individual capability data.
  - Use `GET /api/capabilities/rollup` for aggregated rollup data.
- **UI Library**:
  - Use Recharts or the frontend’s existing chart library (e.g., Chart.js, D3).
- **States**:
  - Loading states (skeletons/spinners).
  - Empty states (placeholder UI for no data).
- **Responsiveness**:
  - Dashboard must work on desktop and tablet views.

### Out of Scope
- Real-time updates (pull-based refresh is sufficient).
- Customization of chart colors/themes (use default palette).
- Export functionality (e.g., CSV/PDF of capability data).
- User-specific dashboard configurations or saved filters.
- Mobile-specific layouts (responsive but not optimized for mobile).
- Editing capabilities directly from the dashboard.
- Integration with third-party tools (e.g., Jira, Slack).

---

## 4. Functional Requirements

### Dashboard UI Components
| Component               | Requirements                                                                 |
|-------------------------|-----------------------------------------------------------------------------|
| **Health Score Gauge**  | - Display a numeric health score (0-100) as a gauge/meter.                 |
|                         | - Color-code based on score thresholds (e.g., red/yellow/green).           |
|                         | - Show a label (e.g., "Health Score: 85").                                  |
| **Status Breakdown**    | - Show shipped/in_progress/planned capabilities as a pie or bar chart.     |
|                         | - Display percentages and counts for each status.                           |
|                         | - Allow toggling between pie and bar chart views.                           |
| **Category Breakdown**  | - Show capabilities grouped by category (e.g., UX, Performance, Security). |
|                         | - Use a stacked bar, donut, or grouped bar chart.                           |
|                         | - Display counts for each category.                                         |
| **Capabilities Table**  | - Show individual capabilities in a table with columns:                    |
|                         |   - Name (link to capability detail, if available).                        |
|                         |   - Status (shipped/in_progress/planned).                                   |
|                         |   - Category.                                                               |
|                         |   - Health score (if applicable).                                           |
|                         |   - Last updated date.                                                      |
|                         | - Support sorting by any column.                                            |
|                         | - Support filtering by status, category, or health score range.            |
| **Navigation**          | - Add a link to the Capabilities Dashboard from the project page.          |
|                         | - Ensure link is visible in the project sub-navigation or sidebar.         |

### API Integration
| Endpoint                          | Usage                                                                       |
|-----------------------------------|-----------------------------------------------------------------------------|
| `GET /api/projects/:id/capabilities` | Fetch list of individual capabilities for the table.                     |
| `GET /api/capabilities/rollup`    | Fetch aggregated data for Health Score, Status Breakdown, and Category Breakdown. |

### States
| State          | Requirements                                                                 |
|----------------|-----------------------------------------------------------------------------|
| **Loading**    | - Show skeleton loaders or spinners for charts and table.                  |
|                | - Disable interactions during loading.                                      |
| **Empty**      | - Show placeholder UI with messaging ("No capabilities found").            |
|                | - Include a CTA to add capabilities if applicable (future scope).          |
| **Error**      | - Display error message if API calls fail.                                  |
|                | - Allow retry mechanism.                                                    |

---

## 5. Acceptance Criteria
### Dashboard UI
1. **Health Score Gauge**:
   - Displays a gauge/meter with the correct numeric score (0-100).
   - Color-coding reflects predefined thresholds (e.g., <50: red, 50-80: yellow, >=80: green).
   - Label is visible and formatted correctly.
2. **Status Breakdown**:
   - Pie or bar chart renders with accurate data (shipped/in_progress/planned counts/percentages).
   - Toggle between pie/bar charts works without page reload.
3. **Category Breakdown**:
   - Stacked/grouped chart renders correctly with category data.
   - Categories and counts are legible.
4. **Capabilities Table**:
   - Displays all capabilities with correct columns (name, status, category, health score, last updated).
   - Sorting works for all sortable columns (ascending/descending).
   - Filtering works for status, category, and health score range.
   - Pagination works if >20 capabilities (if implemented).
5. **Navigation**:
   - Capabilities Dashboard link is accessible from the project page.
   - Link navigates to the correct dashboard page.

### API Integration
1. **Data Fetching**:
   - Dashboard loads data from `/api/projects/:id/capabilities` and `/api/capabilities/rollup` on page load.
   - Handles API errors gracefully (e.g., 404, 500).
2. **Data Accuracy**:
   - All charts and tables reflect data from the APIs without discrepancies.

### States
1. **Loading**:
   - Skeleton loaders/spinners are visible during API calls.
   - No content is rendered until data is fully loaded.
2. **Empty**:
   - Placeholder UI is shown if no capabilities exist.
   - Messaging is clear and actionable.
3. **Error**:
   - Error messages are user-friendly (e.g., "Failed to load capabilities. [Retry]").
   - Retry mechanism works.

### Responsiveness
1. **Desktop/Tablet**:
   - All components render correctly at standard desktop and tablet breakpoints.
2. **Cross-Browser**:
   - Works on latest versions of Chrome, Firefox, Safari, and Edge.

---

## 6. Out of Scope (Reiterated)
- Real-time updates or WebSocket integration.
- Custom chart themes/colors or user-specific dashboard configurations.
- Export functionality (CSV/PDF/Excel).
- Mobile-optimized layouts (beyond basic responsiveness).
- Editing capabilities directly from the dashboard.
- Integration with external tools (e.g., Jira, Slack).

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