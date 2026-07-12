> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #303
> _Each agent that updates this PRD signs its change below._

# PRD: Yellow Risk Score Indicator (50–74)

## Problem & Goal

Users of the platform currently lack a clear, consistent visual and functional signal when an entity (user, account, process, or metric) falls into an **"at risk"** state — defined as a score between **50 and 74** on a 0–100 scale. Without this signal, stakeholders miss early warning opportunities and cannot act before an issue escalates to critical (red) status.

**Goal:** Implement a "Yellow" risk tier that surfaces at-risk entities prominently, communicates urgency without alarm, and prompts timely intervention.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Operations Manager** | Needs a dashboard view of all at-risk items to prioritize team action |
| **Customer Success Manager** | Monitors account health scores; needs early warning before churn risk escalates |
| **Risk & Compliance Analyst** | Tracks process or policy adherence scores; needs audit-ready state records |
| **End User / Subject** | May need to see their own score status and understand what actions to take |
| **System Administrator** | Configures thresholds, notification rules, and escalation policies |

---

## Scope

This document covers the detection, display, notification, and logging of the Yellow (50–74) risk tier within the existing scoring framework. It assumes a scoring engine already produces numerical scores on a 0–100 scale.

**In scope:**
- Visual indicator (color, icon, label) for Yellow state
- Score threshold detection logic (50–74 inclusive)
- In-app badge and list/table row highlighting
- Notification triggers for Yellow entry and exit events
- Audit log entries for state transitions into/out of Yellow
- Tooltip / contextual help explaining what Yellow means

**Out of scope:** *(see dedicated section below)*

---

## Functional Requirements

### FR-1 · Threshold Detection
- The system MUST classify any score **≥ 50 and ≤ 74** as `YELLOW`.
- Boundary scores (50 and 74) MUST be included in the Yellow tier.
- Score classification MUST re-evaluate in real time (or on each score update event) and reflect the current value without requiring a page refresh.

### FR-2 · Visual Indicator
- Yellow state MUST be represented by the hex color **`#F5A623`** (amber-yellow) or the design system's `--color-warning` token, whichever is defined in the active design system.
- A **warning icon** (⚠ or equivalent system icon) MUST accompany the color wherever the score label is displayed.
- The label text MUST read **"At Risk"** in all UI surfaces (dashboards, detail views, exported reports).
- Color MUST NOT be the sole differentiator; the icon and/or text label MUST always co-appear to satisfy WCAG 2.1 AA accessibility requirements.

### FR-3 · Dashboard & List Views
- Rows or cards in Yellow state MUST display the amber background tint or left-border accent as defined in the component spec.
- Dashboard MUST support **filtering** to show only Yellow-tier items.
- Dashboard MUST display a **summary count** of current Yellow-tier items in the risk overview widget.
- Default sort order on the risk dashboard MUST place Yellow items above Green (0–49) and below Red (75–100).

### FR-4 · Detail / Profile View
- The entity detail page MUST show the score badge with the Yellow indicator prominently in the header section.
- A contextual tooltip or inline help panel MUST explain: *"This score is between 50 and 74, indicating the item is at risk. Review contributing factors below and take action to prevent escalation."*
- Contributing factors or sub-scores driving the overall score MUST be visible on the detail page (existing feature; must remain functional in Yellow state).

### FR-5 · Notifications & Alerts
- The system MUST send a notification when an entity **enters** the Yellow tier (score crosses 50 going up, or crosses 74 going down from Red).
- The system MUST send a notification when an entity **exits** Yellow (drops below 50 or rises above 74).
- Notification channels: in-app notification center, email digest (daily or immediate — configurable per user preference), and webhook payload for integrations.
- Notification content MUST include: entity name/ID, current score, previous score, timestamp, and a deep link to the detail view.
- System Administrators MUST be able to suppress or redirect notifications by role, entity type, or individual entity.

### FR-6 · Audit Log
- Every transition **into or out of** Yellow state MUST be recorded in the audit log with: timestamp (UTC), entity ID, previous score, new score, previous tier, new tier, and triggering event source.
- Audit log entries MUST be immutable and retained per the platform's standard retention policy (minimum 90 days).

### FR-7 · Accessibility
- All Yellow indicators MUST achieve a minimum **3:1 contrast ratio** for the icon/text against its background (WCAG 2.1 AA, non-text contrast).
- Screen readers MUST announce state as *"At Risk"* — not just the color name.

---

## Acceptance Criteria

| ID | Criterion | Verification Method |
|---|---|---|
| AC-01 | A score of 50 is classified as `YELLOW` | Unit test: score = 50 → tier = YELLOW |
| AC-02 | A score of 74 is classified as `YELLOW` | Unit test: score = 74 → tier = YELLOW |
| AC-03 | A score of 49 is **not** classified as `YELLOW` | Unit test: score = 49 → tier = GREEN |
| AC-04 | A score of 75 is **not** classified as `YELLOW` | Unit test: score = 75 → tier = RED |
| AC-05 | Yellow badge renders with warning icon and "At Risk" label | Visual regression test + manual review |
| AC-06 | Dashboard filter for Yellow returns only 50–74 entities | Integration test with seeded data |
| AC-07 | Notification is sent within 60 seconds of a Yellow entry event | End-to-end test with mock score update |
| AC-08 | Notification is sent within 60 seconds of a Yellow exit event | End-to-end test with mock score update |
| AC-09 | Audit log entry is created for every Yellow state transition | Integration test; verify log record fields |
| AC-10 | Yellow indicator passes WCAG 2.1 AA contrast check | Automated axe-core scan + manual check |
| AC-11 | Screen reader announces "At Risk" on Yellow badge | Manual assistive technology test (NVDA / VoiceOver) |
| AC-12 | Suppressing notifications for an entity stops Yellow alerts for that entity | Integration test with suppression rule applied |

---

## Out of Scope

- **Scoring engine logic** — how scores are calculated is owned by a separate service; this PRD only consumes score values.
- **Red tier (75–100)** and **Green tier (0–49)** feature changes — handled in separate PRDs.
- **Mobile native apps** — Yellow indicator for iOS/Android native surfaces is a follow-on effort.
- **Bulk remediation workflows** — tooling to resolve at-risk items in bulk is a separate initiative.
- **SLA or time-based auto-escalation** — automatic promotion from Yellow to Red after a time period is out of scope for this release.
- **Custom threshold configuration by tenant** — all tenants use the fixed 50–74 range in this release; configurable thresholds are a future enhancement.
- **Historical trend charts** — visualization of score history over time is handled by the Analytics PRD.