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

_Owned by the business-analyst — authored 2026-08-03._

### Business Context

GAP-G2 is a tracked security finding within the organisation's remediation programme. It was opened through a prior security assessment (penetration test, audit, or vulnerability scan) and, as of this PRD, has been resolved and closed in the authoritative Remediation Tracking System (RTS). The Security Provisioning Dashboard — a real-time operational view used daily by SOC analysts, compliance officers, and risk managers — currently shows GAP-G2 as an open gap. This stale state causes:

- **Duplicated triage effort:** Analysts re-investigate GAP-G2 because the dashboard implies it is still open.
- **Compliance-reporting drift:** Compliance officers pulling dashboard snapshots for audit evidence incorrectly report GAP-G2 as an unresolved finding.
- **Eroded trust in the dashboard:** When one gap is visibly stale, stakeholders question the accuracy of every other gap shown.

Closing this visibility gap is a high-value, low-effort correctness fix: the data already exists in the RTS; the dashboard simply does not consume it for GAP-G2's closure state.

### User Stories

| ID | As a… | I want to… | So that… |
|----|-------|-------------|----------|
| US-1 | SOC Analyst | See that GAP-G2 is Closed at a glance when I load the Security Provisioning Dashboard | I don't waste time re-triaging a resolved finding |
| US-2 | Compliance Officer | Pull a dashboard screenshot or export showing GAP-G2's closed status with a timestamp and closure reason | I have audit-ready evidence that the gap was addressed |
| US-3 | Security Program Manager | Distinguish a waiver-based closure from a true resolution | I can track residual risk accepted via waivers separately from remediated gaps |
| US-4 | Risk Manager | See a clear error state ("Status unavailable") when the remediation source is unreachable, without the rest of the dashboard breaking | I know when data is stale vs. when a gap is genuinely open |

### Detailed Business Requirements

#### BR-1 — Gap Status Data Contract
The dashboard SHALL consume gap status from the Remediation Tracking System (RTS) via a well-defined API endpoint. Each response for a gap SHALL include, at minimum:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `gapId` | string | Yes | Immutable identifier, e.g. `"GAP-G2"` |
| `status` | enum | Yes | One of: `Open`, `In Progress`, `Resolved`, `Closed – Resolved`, `Closed – Waiver`, `Closed – False Positive`, `Closed – Risk Accepted` |
| `closedAt` | ISO-8601 timestamp | No | Present only when status is a `Closed – *` variant |
| `closedBy` | string | No | User or system identifier that performed the closure |
| `closureReason` | string | No | Free-text justification; REQUIRED for waiver/exception closures |
| `lastUpdated` | ISO-8601 timestamp | Yes | Timestamp of the last status change, used for staleness detection |

#### BR-2 — GAP-G2 Closed-State Rendering
When `status` is any `Closed – *` variant, the GAP-G2 tile/row on the Security Provisioning Dashboard SHALL:

- Display a **green "Closed" badge** (or equivalent positive indicator) in the tile header.
- Render the gap title/label with a **strikethrough** or a **checkmark icon** to convey finality.
- Show **closure metadata** below the tile: closed-at timestamp (converted to the user's browser-local timezone), closure reason, and closed-by identity.
- For `Closed – Waiver` and `Closed – Risk Accepted` specifically, append the distinct label (e.g. **"Closed – Waiver"**) in an amber-tinted inline tag to distinguish residual-risk closures from full remediations.

#### BR-3 — Open-State Continuity
When `status` is `Open` or `In Progress`, the GAP-G2 tile SHALL continue to render its existing open-state treatment. No false-positive "Closed" indicators SHALL appear. This guarantees that re-opening a gap in the RTS immediately restores the correct dashboard state on next fetch.

#### BR-4 — Other Gap Non-Regression
The data-fetching and rendering logic for every other gap (GAP-G1, GAP-G3, … GAP-Gn) SHALL be unchanged by this work. A spot-check SHALL verify:

- GAP-G1 renders its status from the RTS independently of GAP-G2.
- GAP-G3 and any additional gaps continue to display correct data.
- The looping/rendering logic is gap-agnostic — adding GAP-G2 closed-state support does not alter the code path for any other gap.

#### BR-5 — Error Resilience
If the RTS endpoint returns an error (HTTP 4xx/5xx, network timeout, DNS failure) for the GAP-G2 status fetch:

- The GAP-G2 tile SHALL display **"Status unavailable"** in a muted/neutral style.
- The error SHALL be logged to the browser console (or equivalent diagnostics channel) with the error code/message.
- **No other gap tile, widget, or dashboard section SHALL break, stall, or fail to render** because GAP-G2's fetch failed. Each gap's data fetch SHALL be independently error-bounded.

#### BR-6 — Performance
The additional API call (or the additional field processing within an existing bulk call) SHALL NOT increase the dashboard's time-to-interactive by more than 200 ms in a controlled test environment (matching the AC). If a dedicated per-gap call is used, it SHALL be non-blocking (Promise.all / concurrent fetch) relative to other gap fetches.

### Data Flow Diagram (Conceptual)

```
┌──────────────────────┐       HTTP GET /gaps/{gapId}/status       ┌──────────────────────┐
│  Security Provisioning │  ◄────────────────────────────────────── │  Remediation Tracking │
│      Dashboard         │                                          │      System (RTS)      │
│  (Browser / Web App)   │  ──────────────────────────────────────► │                        │
│                        │       JSON { gapId, status, ... }        └──────────────────────┘
└────────┬───────────────┘
         │
         ▼
┌──────────────────────┐
│  GAP-G2 Tile          │
│  ┌──────────────────┐ │
│  │ 🟢 Closed         │ │  ← closed-state rendering (BR-2)
│  │ Closed: 2026-…   │ │
│  │ Reason: resolved  │ │
│  │ By: j.smith       │ │
│  └──────────────────┘ │
└──────────────────────┘
```

### Traceability Matrix

| Functional Requirement | Business Requirements | Acceptance Criteria |
|------------------------|----------------------|---------------------|
| FR-1 (Status ingestion) | BR-1, BR-5 | AC: "within 1 minute of refresh" |
| FR-2 (Closed state rendering) | BR-2 | AC: "distinct visual indicator" |
| FR-3 (Metadata display) | BR-2 | AC: "timestamp in local timezone + closure reason" |
| FR-4 (Waiver/exception handling) | BR-2 | AC: "Closed – Waiver distinctly marked" |
| FR-5 (Fallback and error handling) | BR-5 | AC: "Status unavailable, log error, rest of dashboard unaffected" |
| FR-6 (Non-regression) | BR-3, BR-4 | AC: "No other gap tile affected; spot-check passes" |

### Assumptions & Dependencies

1. **RTS API exists and is stable.** The endpoint returning gap status is already deployed and returning the data contract described in BR-1. If the RTS API must be extended to provide closure metadata, that work is out of scope for this task and must be completed by the RTS platform team before dashboard development begins.

2. **Authentication to RTS is pre-established.** The dashboard's existing session/auth token is sufficient to call the RTS endpoint. No new authentication integration is in scope.

3. **GAP-G2's gapId is stable.** The identifier `"GAP-G2"` does not change in the RTS. If RTS uses a different internal ID, a mapping must be provided by the RTS team.

4. **Dashboard framework is React/TypeScript** (consistent with the `Builderforce.ai/frontend/` tree). If the actual Security Provisioning Dashboard uses a different stack, the implementation approach adapts but the business requirements remain valid.

5. **One dashboard deployment.** This change targets the single, current Security Provisioning Dashboard web application. No mobile, no executive summary, no secondary views.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._