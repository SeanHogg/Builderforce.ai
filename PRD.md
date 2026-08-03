> **PRD** — drafted by Ada (Sr. Product Mgr) · task #587
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: GAP-G2 Closure Visibility on Security Provisioning Dashboard

## Problem & Goal
**Problem:** The Security Provisioning Dashboard does not reflect the closed status of the security gap GAP-G2. Stakeholders cannot determine from the dashboard that GAP-G2 is no longer an outstanding risk, leading to confusion and duplicated effort.

**Goal:** Update the dashboard so that when GAP-G2 is closed in the authoritative source (e.g., remediation tracker), the dashboard clearly displays its closed status with supporting details.

## Target Users / ICP Roles
- Security Operations Center (SOC) analysts
- Compliance officers
- Security program managers
- Risk management teams

## Scope
- Modify the Security Provisioning Dashboard’s GAP-G2 tile/row/section to display the closed state.
- Integrate with the source of truth for GAP-G2 status (e.g., Remediation Tracking System API).
- Display closure metadata (timestamp, reason, closed by) when available.

## Functional Requirements
1. **Status ingestion:** The dashboard must fetch GAP-G2’s current status from the authoritative system (in real-time or on page refresh) without user action beyond loading the dashboard.
2. **Closed state rendering:** When the status is “Closed”, the dashboard must visually indicate this (e.g., green “Closed” badge, strikethrough text, or checkmark) in the dedicated GAP-G2 area.
3. **Metadata display:** If the source provides closure details, show:
   - Date and time of closure
   - Reason for closure (resolved, waived, false positive, etc.)
   - User or system that closed the gap
4. **Waiver/exception handling:** If GAP-G2 is closed via a waiver or exception, the dashboard must clearly label it (e.g., “Closed – Waiver”) and display relevant justification.
5. **Fallback and error handling:** If the status cannot be retrieved (network error, source down), display an appropriate message (e.g., “Status unavailable”) and log the error without breaking the rest of the dashboard.
6. **Non‑regression:** The update must not alter the display behavior for any other gap (e.g., GAP‑G1, GAP‑G3). All other gaps must continue to reflect their actual statuses from the source.

## Acceptance Criteria
- When GAP‑G2 is marked as closed in the source system, the dashboard updates to show “Closed” with a distinct visual indicator within 1 minute of a manual page refresh (or automatically within a defined polling interval if real‑time update is supported).
- The closed state displays the closure timestamp in the user’s local timezone and the closure reason, if provided by the source.
- A waiver or exception‑based closure is distinctly marked, e.g., “Closed – Waiver”.
- If the source returns an open state for GAP‑G2, the dashboard continues to show it as open (no false positives).
- No other gap tile/row is affected; a spot check confirms GAP‑G1, GAP‑G3, etc. still render their correct statuses.
- The dashboard’s overall load time does not increase by more than 200 ms in a controlled test environment.

## Out of Scope
- Dashboard re‑design or addition of new widgets.
- Bulk closure operations or workflow changes for closing gaps.
- Historical status timeline for GAP‑G2 (only current state is in scope).
- Mobile‑specific layout or other form factors beyond the current web dashboard.
- Changes to the source system’s API or data model.
- Dashboards or views beyond the existing Security Provisioning Dashboard (e.g., executive summary dashboards).

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