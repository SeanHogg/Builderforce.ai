> **PRD** — drafted by Ada (Sr. Product Mgr) · task #549
> _Each agent that updates this PRD signs its change below._

# Portfolio Health Summary Feature

## Problem & Goal
Portfolio managers lack an immediate, at-a-glance view of portfolio health and the most critical next actions. Without this, prioritization is slower and key risks are missed.

**Goal:** Provide an above-the-fold Portfolio Snapshot that delivers a concise health summary (total projects, color-coded status counts, overall portfolio status) and surfaces the top-3 priority actions to drive rapid decision-making.

## Target Users / ICP Roles
- Portfolio Managers
- Project Leads
- Executive Stakeholders  
*(all users viewing the project portfolio dashboard)*

## Scope
- Frontend UI component placed at the top of the main portfolio dashboard.
- Hardcoded or semi-static implementation using existing project summary data: 5 projects, predetermined status distribution, and predefined top-3 actions.
- No backend changes; the component consumes what is already available.

## Functional Requirements

### FR-4: Portfolio Snapshot
The system **shall** display an above-the-fold section containing:
- **Total project count:** 5
- **Status breakdown** with labeled counts for each color:
  - Green: *count*
  - Amber: *count*
  - Red: *count*
- **Overall portfolio health indicator:** `RED`
- **Priority Actions** (ordered list, top-3):
  1. Fix Hired.Video build
  2. Kickoff RumbleDating
  3. Define or archive pattysnob.com

The section must be visible without scrolling on a standard viewport (above the fold).

## Acceptance Criteria

- **AC-6:** The Portfolio Snapshot section renders at the top of the portfolio dashboard and is fully visible without scrolling (above the fold).
- **AC-7:** The snapshot accurately shows:
  - Total projects = **5**
  - Color-coded counts for Green, Amber, Red (matching the underlying project status data)
  - Overall health indicator displayed as **"RED"**
  - The top-3 priority actions exactly as follows, in order:
    1. **Fix Hired.Video build**
    2. **Kickoff RumbleDating**
    3. **Define or archive pattysnob.com**

## Out of Scope
- Dynamic, live recalculation of portfolio health (static/hardcoded values acceptable for now).
- Automated prioritization algorithm for actions.
- Actionable links or interactive elements on the priority action items.
- Notification, alerting, or escalation triggers.
- Mobile-specific responsive behavior beyond basic visibility.
- Backend API or database modifications.

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