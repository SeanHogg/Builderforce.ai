> **PRD** — drafted by Ada (Sr. Product Mgr) · task #574
> _Each agent that updates this PRD signs its change below._
> - **Requirements** authored by Business Analyst · `builderforce/task-574`
> - **Product Strategy & Success Metrics** authored by Product Manager · `builderforce/task-574`

# Security Provisioning Dashboard: GAP-G1 Closed Reflection

## Problem & Goal
**Problem:** The Security Provisioning dashboard currently lacks visibility into the closure state of critical access provisioning gaps. Stakeholders must manually query underlying systems to confirm whether GAP‑G1 (a high‑priority, cross‑platform provisioning deficiency) has been resolved. This leads to delayed risk acceptance decisions, redundant audit requests, and an inaccurate representation of the organization's access security posture.

**Goal:** Automatically reflect the closure of GAP‑G1 on the Security Provisioning dashboard, so that security operations, IAM teams, and internal auditors have a single, trusted, near‑real‑time view of this gap's status. The update must eliminate manual reporting, reduce mean‑time‑to‑awareness, and provide clear audit evidence.

## Target Users / ICP Roles
- **Security Operations Center (SOC) Analysts** – monitor overall security posture and escalate unresolved gaps.
- **IAM / Provisioning Administrators** – own the remediation lifecycle and need to confirm closure is recognized.
- **Compliance & Internal Audit** – require reliable evidence that GAP‑G1 is closed during audits.
- **CISO / Security Leadership** – view executive dashboards that aggregate risk metrics.

## Scope
**In scope:**
- Dashboard widget or tile dedicated to GAP‑G1 (or integration into an existing "Open Gaps" panel) that displays `OPEN` / `CLOSED` status.
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
   The dashboard shall display a prominent widget labeled "GAP‑G1 Status" that shows the current state (Open / Closed) using a clearly distinguishable visual treatment (e.g., green shield for Closed, red warning for Open).

2. **Data Source Integration**  
   The widget shall consume data from the authoritative source of truth (e.g., ServiceNow GRC, AWS IAM Access Analyzer, or a custom rules engine API). The integration must support a REST API endpoint that returns the latest status and metadata for GAP‑G1.

3. **Automatic Refresh**  
   The status shall update no more than 5 minutes after the source system records the closure. The dashboard shall display the timestamp of the last refresh.

4. **Closure Evidence**  
   When status is "Closed," a hyperlink must be available that directs the user to the remediation evidence (change ticket, updated policy document, automated attestation report, etc.).

5. **Historical Context**  
   The widget must include an unobtrusive historical trend line or text indicating the date GAP‑G1 was opened and the date it was closed (if applicable). Optionally, a "View History" link can show a timeline of status changes.

6. **Transition Highlight**  
   For 7 calendar days after a transition to "Closed" (or when a previously closed gap re‑opens), the widget background or border shall show a highlighted animation (e.g., pulsing) to draw attention to the change.

7. **Manual Override (Audit)**  
   Dashboard administrators shall have the ability to manually set the status to Closed (with mandatory comment) for testing or exceptional audit scenarios. Manual overrides shall be clearly marked as "Manual – not system verified."

8. **Error / Stale Data Handling**  
   If the data source is unreachable or the status hasn't been updated in > 15 minutes, the widget shall display a "Data stale" warning with the last known status and time.

## Acceptance Criteria
1. When the authoritative source marks GAP‑G1 as "Closed," the dashboard widget changes to "Closed" within ≤ 5 minutes.
2. Clicking the evidence link opens the correct remediation record (no broken links).
3. The widget clearly distinguishes between "Open" and "Closed" states per the design guidelines (color, icon, text).
4. Historical data shows the correct open date (before closure) and the closure date once closed.
5. The highlight animation appears for a freshly closed gap and disappears after 7 days (system clock).
6. Manual override capability works: an admin can set status to Closed, the widget shows "Manual" annotation, and the change is recorded in an audit log.
7. When the source endpoint returns an error or is unreachable, the widget displays "Data stale" and the previous status within 5 minutes of the failure.
8. The feature does not negatively impact dashboard load time; the widget renders within 2 seconds of page load.

## Out of Scope
- Any changes to the underlying provisioning control that remediated GAP‑G1.
- Automated email or Slack alerts—observability limited to dashboard.
- Mobile responsiveness or dedicated mobile app support for this widget.
- Multi‑language localization (English only for v1).
- Historical reporting beyond the simple trend line—no exportable PDFs or detailed trend reports in this phase.
- Integration with SIEM/SOAR for automated ticket creation from the dashboard (read‑only status reflection).

## Requirements

> Authored by Business Analyst · `builderforce/task-574`

### REQ-1: GAP-G1 Status Widget — UI Component

**1.1 — Widget Container.** The dashboard shall render a self-contained widget component labeled "GAP‑G1 Status" that is visually distinct from surrounding dashboard tiles (border, shadow, and header styling consistent with the existing dashboard design system).

**1.2 — Status Display.** The widget shall render a prominent status indicator:

| State | Icon | Text | Color |
|-------|------|------|-------|
| `open` | ⚠️ warning triangle or red circle | "OPEN" | Red (`#ef4444` or design-token `--color-danger`) |
| `closed` | ✅ shield / checkmark | "CLOSED" | Green (`#22c55e` or design-token `--color-success`) |
| `stale` | ⚡ stale indicator | "Data stale" (with last known status alongside) | Amber / orange (`#f59e0b`) |
| `manual` | 🛡️ shield with pencil / annotation | "CLOSED — Manual" (with annotation text visible below) | Blue (`#3b82f6`) |

**1.3 — Accessibility.** The status indicator shall be announced by screen readers with an `aria-label` reading, e.g., "GAP‑G1 status: Closed," and colour must not be the sole differentiator (icons + text must also convey the state).

**1.4 — Responsive Behaviour.** The widget shall fit within a standard dashboard grid cell at ≥ 320 px wide without overflow or truncation of critical text. If text overflows, it shall wrap; the widget shall not horizontally scroll.

---

### REQ-2: Data Source Integration — API Contract

**2.1 — Backend Endpoint.** The frontend shall consume a REST API endpoint with the following contract:

```
GET /api/security/gap-g1/status

Response 200 — OK:
{
  "gapId": "GAP-G1",
  "status": "open" | "closed",
  "source": "system" | "manual",
  "openedAt": "2025-03-01T12:00:00Z",       // ISO-8601; the date GAP‑G1 was first registered
  "closedAt": "2025-07-15T09:30:00Z",       // ISO-8601 | null if open
  "closedBy": "jane.doe@org.com",           // string | null if open
  "evidenceUrl": "https://...",             // URL | null if open
  "lastRefreshedAt": "2025-07-15T09:35:00Z",// ISO-8601; when this response was assembled
  "sourceSystem": "servicenow-grc",         // identifier of the authoritative system
  "manualOverride": {
    "active": false,
    "comment": null,
    "overriddenBy": null,
    "overriddenAt": null
  }
}
```

**2.2 — Behaviour under failure.** If the upstream source is unreachable or returns a non‑2xx response, the endpoint shall return HTTP 200 with the last known (cached) state and `"sourceSystem": "cache"` plus a `"stale": true` flag. If no cached data exists, the endpoint shall return HTTP 502 with an error payload.

**2.3 — Manual Override Endpoint.** The dashboard shall expose a second endpoint for the manual‑override capability:

```
POST /api/security/gap-g1/override

Request body (JSON):
{
  "status": "closed",
  "comment": "Resolved via manual audit confirmation per ticket AUDIT-2841."
}

Response 200:
{
  "gapId": "GAP-G1",
  "status": "closed",
  "source": "manual",
  "manualOverride": {
    "active": true,
    "comment": "Resolved via manual audit confirmation per ticket AUDIT-2841.",
    "overriddenBy": "{authenticated-user-email}",
    "overriddenAt": "2025-07-15T10:00:00Z"
  },
  ...
}
```

**2.4 — Authentication.** Both endpoints shall honour the existing dashboard auth session. Requests without a valid session shall return 401. The POST override endpoint shall additionally require an `admin` role claim; non‑admin requests shall return 403.

**2.5 — Configuration.** The URL of the upstream authoritative source shall be configurable via an environment variable (`GAP_G1_SOURCE_URL`) with a sensible fallback. The polling interval shall be configurable via `GAP_G1_POLL_INTERVAL_MS` (default 300 000 ms = 5 minutes). The cache‑TTL before marking data stale shall be configurable via `GAP_G1_STALE_AFTER_MS` (default 900 000 ms = 15 minutes).

---

### REQ-3: Automatic Refresh — Polling & Staleness

**3.1 — Polling Loop.** The frontend widget shall poll the `/api/security/gap-g1/status` endpoint every 60 seconds by default. On each successful response, the widget re‑renders.

**3.2 — Staleness Detection.** The widget shall compare `lastRefreshedAt` against the current client clock. If the delta exceeds 15 minutes, the widget shall transition to the `stale` visual state.

**3.3 — Last‑Refresh Timestamp.** The widget footer shall display a human‑readable "Last refreshed: …" label (e.g., "Last refreshed: 2 minutes ago") derived from `lastRefreshedAt`.

**3.4 — Backoff.** After three consecutive poll failures (non‑2xx or network error), the polling interval shall double (up to a maximum of 10 minutes) until a successful response is received, at which point it resets to 60 seconds.

---

### REQ-4: Closure Evidence — Link & Audit Trail

**4.1 — Evidence Link.** When status is `closed` and `evidenceUrl` is non‑null, the widget shall render a clickable link labelled "View remediation evidence" that opens the URL in a new tab (`target="_blank" rel="noopener noreferrer"`).

**4.2 — Link Validity.** If `evidenceUrl` is `null` but status is `closed`, the widget shall display the text "No evidence link provided" in muted styling rather than a broken or missing link.

**4.3 — Responsible Party.** When `closedBy` is non‑null, the widget shall display "Closed by: {closedBy}" beneath the status indicator.

---

### REQ-5: Historical Context — Timeline

**5.1 — Date Display.** The widget body shall display:
- "Opened: {openedAt formatted as locale date}" — always visible.
- "Closed: {closedAt formatted as locale date}" — visible only when status is `closed`.

**5.2 — "View History" Link.** An optional "View History" link (visible when the consuming org has a history endpoint wired) shall navigate to a timeline of status changes. The endpoint is:

```
GET /api/security/gap-g1/history

Response 200:
{
  "gapId": "GAP-G1",
  "events": [
    { "status": "open",  "source": "system", "timestamp": "2025-03-01T12:00:00Z", "actor": "system" },
    { "status": "closed","source": "system", "timestamp": "2025-07-15T09:30:00Z", "actor": "jane.doe@org.com" }
  ]
}
```

**5.3 — History Fallback.** If the history endpoint is unavailable (501 or 404), the "View History" link shall be hidden rather than show a broken link.

---

### REQ-6: Transition Highlight — Recent‑Closure Animation

**6.1 — Trigger.** When the widget detects a transition from `open` to `closed` (or from any state to `open` after having been `closed`), it shall apply a highlight animation class for 7 calendar days from the `closedAt` (or `openedAt`) timestamp.

**6.2 — Animation.** The highlight shall be a CSS `@keyframes` pulse on the widget's `box-shadow` border (from accent colour to transparent and back, 2‑second cycle) OR a subtle background‑colour gradient that fades to normal after 7 days. The animation shall respect `prefers-reduced-motion`: if set, the highlight shall be a static coloured border rather than an animated pulse.

**6.3 — Expiry.** After `closedAt + 7 days` (computed client‑side against `Date.now()`), the highlight shall be removed without user action. There is no "dismiss" button — the highlight is time‑based only.

---

### REQ-7: Manual Override — Audit Trail

**7.1 — Admin Action.** An administrator (role claim `admin`) shall see a "Manual Override" button within the widget. Clicking it opens an inline form with:
- A mandatory comment textarea (minimum 20 characters).
- A "Set to Closed" submit button.
- A "Cancel" button.

**7.2 — Submission.** On submit, the widget POSTs to `/api/security/gap-g1/override`. On success (200), the widget re‑fetches the status and renders the `manual` visual state.

**7.3 — Audit Log.** Every manual override shall be recorded server‑side in an `gap_g1_override_audit_log` table (or equivalent persistent store) with columns:
- `id` (UUID)
- `gap_id` = "GAP-G1"
- `previous_status`
- `new_status`
- `comment`
- `overridden_by` (authenticated user identity)
- `overridden_at` (timestamp)
- `client_ip`

The audit log shall be append‑only (no UPDATE or DELETE permitted at the application layer).

**7.4 — Reversal.** An admin shall be able to clear a manual override via a second action "Clear Manual Override," which POSTs `{ "status": "open", "comment": "Reverting manual override — re‑establishing system source." }`. After clearing, the widget reverts to the system‑derived status.

---

### REQ-8: Error & Stale Data Handling

**8.1 — Network Error.** If the status endpoint returns a non‑2xx response or the fetch promise rejects (network error), the widget shall:
- Display a "Data stale" label alongside the last known status and its timestamp.
- Apply the `stale` visual treatment (amber colour, stale icon).
- Retain the last known `evidenceUrl`, `closedBy`, and dates.

**8.2 — Staleness Timer.** Client‑side, if `lastRefreshedAt` is older than 15 minutes, the widget shall treat the data as stale even if the last poll succeeded.

**8.3 — Recovery.** When a successful poll returns after a stale period, the widget shall re‑render with the fresh data and clear the stale indicators automatically.

**8.4 — Initial Load (No Cache).** On first page load, before the first API response, the widget shall render a skeleton loader (pulsing placeholder rectangles) for ≤ 2 seconds. If the first fetch takes longer than 2 seconds, the widget shall show a "Loading…" spinner with the widget header visible.

---

### REQ-9: Non‑Functional Requirements

**9.1 — Performance.**
- Widget initial render (after API response) shall complete within 200 ms on a 2022‑era desktop CPU.
- The widget bundle size (JS + CSS) shall not exceed 15 KB gzipped.
- Polling shall use `fetch` with `AbortController`; each poll timeout is 10 seconds.

**9.2 — Availability.**
- The backend `/api/security/gap-g1/status` endpoint shall have a target availability of 99.9 %.
- The endpoint shall respond within 500 ms p95 under normal load.

**9.3 — Security.**
- The override endpoint shall be rate‑limited to 5 requests per minute per user.
- All inputs (comment text, URL) shall be sanitised against XSS before rendering.
- The `evidenceUrl` shall be validated server‑side as a well‑formed HTTPS URL before storage.

**9.4 — Observability.**
- The backend shall emit structured logs for every status poll (INFO: source system, response time, staleness flag) and every override action (WARN: user, comment, previous status).
- The frontend shall emit a client‑side metric (e.g., `gap_g1_widget.render_time`) for dashboard‑load performance.

**9.5 — Configurability.**
- The GAP‑G1 identifier and display label shall be configurable (environment variable `GAP_G1_DISPLAY_LABEL`, default "GAP‑G1 Status") so the same widget can be re‑used for future gaps without code changes.

---

### REQ-10: Dependency & Integration Map

| Dependency | Type | Criticality | Fallback |
|------------|------|-------------|----------|
| IAM control plane / GRC API | External REST | High — without it, only cached data is available | Serve last cached response; mark stale |
| Dashboard auth session | Internal | High — without it, no user‑specific rendering | Redirect to login |
| Audit log store (DB table) | Internal | Medium — manual overrides cannot be persisted without it | Reject override POST with 503 |
| History endpoint | Internal | Low — optional "View History" link | Hide link |

---

## Product Strategy

> Authored by Product Manager · `builderforce/task-574`

### Strategic Rationale

GAP-G1 — the lack of documented sandbox/network egress isolation for Cloud V2 runs using `bypassPermissions` + Bash — is the **single biggest GA blocker** for the Cloud Agent product line (per PRD #09 §4.G). Buyers evaluating the platform cannot commit to cloud-based agent execution without a verifiable isolation model. Every day GAP-G1 remains open is a day the Cloud Agent SKU cannot be sold with a straight face to security-conscious enterprises.

Reflecting GAP-G1 closure on the Security Provisioning dashboard is not cosmetic — it is a **trust signal**. The dashboard is the surface that SOC analysts, IAM admins, and internal auditors already monitor for access-security posture. Surfacing this gap's state there closes the loop between the engineering remediation (owned by the Cloud Agent validation pass) and the stakeholder's awareness of risk reduction.

### Success Metrics (OKR-aligned)

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Mean-time-to-awareness (MTTA) of GAP-G1 closure** | ≤ 5 minutes from source-system state change | Delta between `closedAt` in source system and `lastRefreshedAt` in widget response |
| **Manual audit queries eliminated** | 0 per week after feature launch | Count of direct source-system queries tagged `gap-g1` in audit logs |
| **Widget render time** | ≤ 2 seconds from page load (p95) | Client-side `gap_g1_widget.render_time` metric |
| **Dashboard confidence score** | +15 points on internal security-posture NPS survey | Pre/post launch survey of SOC and IAM team leads |
| **Audit finding resolution time** | Reduced by ≥ 50 % for findings citing GAP-G1 | Mean days from audit finding → evidence accepted, before vs. after feature |

### MVP Definition

The Minimum Viable Product is:

1. **Widget on the Security Provisioning dashboard** displaying `OPEN`/`CLOSED` for GAP-G1.
2. **Polling integration** to the authoritative source (configurable endpoint + cache).
3. **Evidence link** when closed.
4. **Stale-data indicator** when the source is unreachable.

The following are **post-MVP enhancements** (ship in v1.1 or later):
- Manual override with audit log (REQ-7) — deferrable if no admin workflow yet exists.
- Historical timeline / "View History" (REQ-5.2) — nice-to-have, not launch-blocking.
- Transition highlight animation (REQ-6) — polish, not function.

### Prioritization

| Capability | Priority | Rationale |
|------------|----------|-----------|
| REQ-1 (Widget UI) | P0 — must ship | The visible artifact; without it, nothing exists. |
| REQ-2 (API contract) | P0 — must ship | Data plumbing; widget is dead without it. |
| REQ-3 (Polling & staleness) | P0 — must ship | Without refresh, the dashboard is a static snapshot, not a live reflection. |
| REQ-4 (Evidence link) | P0 — must ship | Audit evidence is the primary user job-to-be-done. |
| REQ-5 (Historical context) | P1 — ship in v1 if schedule permits | Adds trust but not strictly required for closure awareness. |
| REQ-6 (Transition highlight) | P2 — v1.1 | Visual polish; no functional gap. |
| REQ-7 (Manual override) | P1 — ship in v1 if schedule permits | Important for audit edge cases; requires backend audit log infra. |
| REQ-8 (Error handling) | P0 — must ship | Stale/missing data without a warning is worse than no widget. |
| REQ-9 (NFRs) | P0 — must ship | Performance, security, config — table stakes for production. |
| REQ-10 (Dependency map) | Informational | Drives implementation sequencing. |

### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Source system API changes or is unreachable** | Medium | High — widget shows stale data, eroding trust | Cache with TTL + stale indicator; configurable endpoint so it can be repointed without a deploy. |
| **GAP-G1 is re-opened after being marked closed** | Medium | Medium — dashboard must accurately reflect re-open | Status is poll-based; the widget transitions back to `OPEN` on the next poll cycle (≤ 5 min). Transition highlight (REQ-6) covers the re-open case. |
| **"Security Provisioning dashboard" does not yet exist as a product surface** | High | High — widget has nowhere to render | **This is the key architectural risk.** The PRD assumes a Security Provisioning dashboard exists. If it does not, the widget must either (a) live on the existing Cross-Project Health Dashboard as a new tile, (b) be created as a standalone page under `/dashboard/security-provisioning`, or (c) be embedded in the Observability timeline. The architect must resolve this in the Design section. |
| **Manual override creates conflicting state with source system** | Low | Medium — audit confusion | Override is clearly marked "Manual – not system verified"; clearing the override re-syncs to system source. |
| **Polling load on source system at scale** | Low | Low — single endpoint, 60 s interval, cached backend-side | Backend caches the source response; frontend polls the cache, not the source directly. |

### Alignment with Portfolio

This feature directly serves the **Cloud Agent Validation & Hardening** initiative (PRD #09). GAP-G1 is a P0 blocker enumerated in that PRD's §4.G. The dashboard widget is the **user-visible signal** that the underlying remediation (sandbox isolation model + red-team check) has been completed. It should ship in the same release window as the GAP-G1 engineering closure, or immediately after.

---

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
