> **PRD** — drafted by Ada (Sr. Product Mgr) · task #574
> _Each agent that updates this PRD signs its change below._

# Security Provisioning Dashboard: GAP-G1 Closed Reflection

## Problem & Goal
**Problem:** The Security Provisioning dashboard currently lacks visibility into the closure state of critical access provisioning gaps. Stakeholders must manually query underlying systems to confirm whether GAP‑G1 (a high‑priority, cross‑platform provisioning deficiency) has been resolved. This leads to delayed risk acceptance decisions, redundant audit requests, and an inaccurate representation of the organization’s access security posture.

**Goal:** Automatically reflect the closure of GAP‑G1 on the Security Provisioning dashboard, so that security operations, IAM teams, and internal auditors have a single, trusted, near‑real‑time view of this gap’s status. The update must eliminate manual reporting, reduce mean‑time‑to‑awareness, and provide clear audit evidence.

## Target Users / ICP Roles
- **Security Operations Center (SOC) Analysts** – monitor overall security posture and escalate unresolved gaps.
- **IAM / Provisioning Administrators** – own the remediation lifecycle and need to confirm closure is recognized.
- **Compliance & Internal Audit** – require reliable evidence that GAP‑G1 is closed during audits.
- **CISO / Security Leadership** – view executive dashboards that aggregate risk metrics.

## Scope
**In scope:**
- Dashboard widget or tile dedicated to GAP‑G1 (or integration into an existing “Open Gaps” panel) that displays `OPEN` / `CLOSED` status.
- Automated data feed that refreshes the dashboard when the authoritative source (IAM control plane or GRC tool) confirms closure.
- Timestamp of closure, responsible party, and a link to supporting remediation evidence.
- Historical trend indicator showing when GAP‑G1 was opened and subsequently closed (optional date‑range slider).
- A basic notification or highlighting mechanism (color change, banner) when closure is recent (< 7 days).

**Out of scope:**
- Redesign of the entire Security Provisioning dashboard.
- Visualisation of other security gaps (GAP‑G2, GAP‑G3, etc.) – only GAP‑G1 is addressed.
- Workflow to actually remediate GAP‑G1 (provisioning policy changes, access reviews, etc.) – the remediation process is owned elsewhere.
- User‑facing alerting to external channels (email, Slack) – limited to in‑dashboard indicator.
- Role‑based access control changes to the dashboard itself (existing permissions remain).

## Functional Requirements
1. **GAP‑G1 Status Widget**  
   The dashboard shall display a prominent widget labeled “GAP‑G1 Status” that shows the current state (Open / Closed) using a clearly distinguishable visual treatment (e.g., green shield for Closed, red warning for Open).

2. **Data Source Integration**  
   The widget shall consume data from the authoritative source of truth (e.g., ServiceNow GRC, AWS IAM Access Analyzer, or a custom rules engine API). The integration must support a REST API endpoint that returns the latest status and metadata for GAP‑G1.

3. **Automatic Refresh**  
   The status shall update no more than 5 minutes after the source system records the closure. The dashboard shall display the timestamp of the last refresh.

4. **Closure Evidence**  
   When status is “Closed,” a hyperlink must be available that directs the user to the remediation evidence (change ticket, updated policy document, automated attestation report, etc.).

5. **Historical Context**  
   The widget must include an unobtrusive historical trend line or text indicating the date GAP‑G1 was opened and the date it was closed (if applicable). Optionally, a “View History” link can show a timeline of status changes.

6. **Transition Highlight**  
   For 7 calendar days after a transition to “Closed” (or when a previously closed gap re‑opens), the widget background or border shall show a highlighted animation (e.g., pulsing) to draw attention to the change.

7. **Manual Override (Audit)**  
   Dashboard administrators shall have the ability to manually set the status to Closed (with mandatory comment) for testing or exceptional audit scenarios. Manual overrides shall be clearly marked as “Manual – not system verified.”

8. **Error / Stale Data Handling**  
   If the data source is unreachable or the status hasn’t been updated in > 15 minutes, the widget shall display a “Data stale” warning with the last known status and time.

## Acceptance Criteria
1. When the authoritative source marks GAP‑G1 as “Closed,” the dashboard widget changes to “Closed” within ≤ 5 minutes.
2. Clicking the evidence link opens the correct remediation record (no broken links).
3. The widget clearly distinguishes between “Open” and “Closed” states per the design guidelines (color, icon, text).
4. Historical data shows the correct open date (before closure) and the closure date once closed.
5. The highlight animation appears for a freshly closed gap and disappears after 7 days (system clock).
6. Manual override capability works: an admin can set status to Closed, the widget shows “Manual” annotation, and the change is recorded in an audit log.
7. When the source endpoint returns an error or is unreachable, the widget displays “Data stale” and the previous status within 5 minutes of the failure.
8. The feature does not negatively impact dashboard load time; the widget renders within 2 seconds of page load.

## Out of Scope
- Any changes to the underlying provisioning control that remediated GAP‑G1.
- Automated email or Slack alerts—observability limited to dashboard.
- Mobile responsiveness or dedicated mobile app support for this widget.
- Multi‑language localization (English only for v1).
- Historical reporting beyond the simple trend line—no exportable PDFs or detailed trend reports in this phase.
- Integration with SIEM/SOAR for automated ticket creation from the dashboard (read‑only status reflection).

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