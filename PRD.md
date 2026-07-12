> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #304
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document — Red Alert Threshold System

## Status: WIP (Work In Progress)

---

## Problem & Goal

Metric values falling in the **0–49 range** currently produce no immediate, visually distinct signal to operators and stakeholders monitoring dashboards or reports. Critical conditions are missed or discovered late, increasing response time and risk.

**Goal:** Implement a standardized "Red" severity tier that automatically flags any numeric score, metric, or KPI value between **0 and 49 (inclusive)** with a distinct red visual treatment and actionable alert behavior across the product surface.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Operations Analyst** | Instantly spot critical metrics without scanning raw numbers |
| **Engineering On-Call** | Receive timely alerts when system health scores drop below 50 |
| **Product Manager** | Track feature adoption or quality scores and act before scores worsen |
| **Executive / Stakeholder** | High-level dashboard view with unambiguous red indicators for escalation decisions |
| **QA Engineer** | Validate threshold logic and visual rendering during test cycles |

---

## Scope

### In Scope

- Detection and classification of any numeric metric value in the range **0–49 (inclusive)**
- Visual rendering of the **Red** state (color token, icon, label) in:
  - Data tables
  - Dashboard cards / widgets
  - Inline metric displays
  - Export views (PDF, CSV annotations)
- Alert/notification dispatch when a value enters the Red tier
- Severity label: `"Critical"` mapped to the Red tier
- Threshold configuration (ability to adjust the 0–49 boundary per metric type)
- Accessibility compliance for red color usage (WCAG 2.1 AA)

### Out of Scope

- Yellow (50–74) and Green (75–100) tier logic *(handled in separate PRDs)*
- Third-party integrations beyond the existing notification pipeline
- Historical trend analysis or root-cause tooling
- Mobile-native (iOS/Android) implementations in this iteration

---

## Functional Requirements

### FR-1 — Threshold Evaluation

- The system **must** evaluate every numeric metric value against the Red boundary upon data ingestion or refresh.
- A value `v` is classified **Red** if and only if `0 ≤ v ≤ 49`.
- Null, negative, or non-numeric values **must** be excluded from Red classification and flagged as `"No Data"`.

### FR-2 — Visual Treatment

- Red tier **must** use the design system's `color-critical` token (hex `#D32F2F` or approved equivalent).
- A warning icon (`⚠` or system icon `alert-circle`) **must** accompany the value.
- The text label `"Critical"` **must** appear adjacent to or below the metric value.
- Red state **must** pass WCAG 2.1 AA contrast ratio (≥ 4.5:1) against both light and dark backgrounds.

### FR-3 — Alerting & Notifications

- When a metric transitions **into** the Red tier, a notification **must** be dispatched within **60 seconds** of detection.
- Notification channels: in-app banner, email digest, and webhook (if configured).
- Notifications **must** include: metric name, current value, timestamp, and a deep link to the relevant dashboard view.
- Repeat notifications **must not** be sent more than once every **30 minutes** for the same metric while it remains in Red (alert fatigue prevention).

### FR-4 — Threshold Configuration

- Authorized users (Admin role) **must** be able to adjust the upper Red boundary (default: 49) per metric, within the range of 1–99.
- Configuration changes **must** be logged in the audit trail with actor, timestamp, old value, and new value.
- Configuration UI **must** display a live preview of how existing metric values would be reclassified under the new threshold.

### FR-5 — Data Table & Export

- All tabular views displaying affected metrics **must** render a red background row highlight or a red badge in the severity column.
- CSV exports **must** include a `severity` column populated with `"Critical"` for Red-tier rows.
- PDF exports **must** render the red color treatment (not grayscale fallback).

---

## Acceptance Criteria

| ID | Criterion | Verification Method |
|---|---|---|
| AC-1 | A metric value of `0` is classified Red and displays the Critical label. | Automated unit test |
| AC-2 | A metric value of `49` is classified Red and displays the Critical label. | Automated unit test |
| AC-3 | A metric value of `50` is **not** classified Red. | Automated unit test |
| AC-4 | A null or non-numeric value is classified `"No Data"`, not Red. | Automated unit test |
| AC-5 | Red color token renders at ≥ 4.5:1 contrast ratio on white and `#1E1E1E` backgrounds. | Accessibility audit / automated contrast check |
| AC-6 | Notification fires within 60 seconds of a value entering the Red tier. | Integration test with mocked clock |
| AC-7 | No duplicate notification is sent within a 30-minute window for the same metric. | Integration test |
| AC-8 | Notification payload contains metric name, value, timestamp, and deep link. | Contract test |
| AC-9 | Admin can change the Red upper boundary; change appears in audit log. | E2E test |
| AC-10 | CSV export includes `"Critical"` in the `severity` column for Red-tier rows. | Automated export test |
| AC-11 | PDF export renders red color (verified via pixel/color sampling in CI). | Visual regression test |
| AC-12 | Dashboard card displaying a Red metric loads within existing performance SLA (≤ 2 s). | Performance test |

---

## Out of Scope

- **Yellow tier (50–74)** and **Green tier (75–100)** classification logic
- Machine-learning-based anomaly detection or dynamic thresholds
- Mobile-native (iOS / Android) Red state rendering
- Retroactive re-alerting for historical data points that were in the Red range before this feature shipped
- Customer-facing public status page integration
- Internationalization / localization of the "Critical" label beyond English (deferred to i18n sprint)
- SLA breach workflows or escalation routing beyond the notification dispatch

---

*Document owner: TBD | Last updated: see commit history | Next review: before sprint kickoff*