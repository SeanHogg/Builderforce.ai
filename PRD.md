> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #263
> _Each agent that updates this PRD signs its change below._

# PRD: Resumable Sessions — Save Progress & Return Later

---

## Problem & Goal

Users working through multi-step flows (forms, wizards, assessments, configurations, checkouts, or content creation) frequently cannot complete their task in a single session. When they leave and return, they are forced to start over, causing frustration, drop-off, and lost work.

**Goal:** Implement a first-class "resumable session" capability that automatically or manually saves a user's in-progress state and allows them to return — on any device or browser — and continue exactly where they left off, with zero data loss.

---

## Target Users / ICP Roles

| Role | Context |
|---|---|
| **End User (Primary)** | Any user mid-way through a multi-step flow who needs to pause and return later |
| **Returning User** | Same user resuming on the same or a different device/browser |
| **Admin / Operator** | Needs visibility into abandoned/in-progress sessions for analytics and cleanup |
| **Developer / Integrator** | Builds new flows that need to opt into resumable session support |

---

## Scope

This document covers save-and-resume functionality for **multi-step, stateful user flows** within the product. It applies to any flow that has two or more steps and takes non-trivial time or effort to complete.

---

## Functional Requirements

### FR-1 — Automatic State Persistence
- The system **must** auto-save the user's current progress after every completed step and after every meaningful input change (debounced, max 5-second delay).
- Saved state must include: current step index, all field values entered so far, any uploaded file references, selected options, and a UTC timestamp of the last save.
- Auto-save must be non-blocking and must not interrupt the user's active interaction.

### FR-2 — Manual Save ("Save & Exit")
- A visible **"Save & Exit"** control must be available at all times during an in-progress flow.
- On activation, the system saves the current state, confirms success with a brief toast/notification, and navigates the user to a safe exit destination (dashboard or home).
- A unique **resume link or code** must be presented to the user at the moment of manual save.

### FR-3 — Resume Link / Token
- Each saved session must generate a unique, URL-safe, non-guessable token.
- The resume URL must be shareable and must work across devices and browsers.
- Tokens must be tied to a user account when the user is authenticated; for unauthenticated users, the token alone grants access (no login required to resume).
- Tokens must expire after a configurable period (default: **30 days** of inactivity).

### FR-4 — Session Detection on Re-entry
- When an authenticated user starts a flow they have previously saved, the system **must** detect the existing draft and prompt: **"You have unsaved progress from [date/time]. Resume where you left off?"** with options **Resume** and **Start Over**.
- When an unauthenticated user follows a resume link, the flow must open directly at the saved step without a prompt.
- If multiple saved drafts exist (authenticated), the user must be shown the most recent and given access to a list of all drafts.

### FR-5 — State Restoration
- On resume, all previously entered field values, selections, and uploaded file references must be re-populated exactly as left.
- The user must be placed on the **last active step**, not the beginning.
- Validation must not be re-triggered on already-completed steps unless the user revisits them.
- If a previously referenced file or external resource is no longer available, the system must surface a clear, actionable warning on that specific field only.

### FR-6 — Draft Management (User-Facing)
- Authenticated users must have a **"My Drafts"** view listing all in-progress sessions with: flow name, last-saved timestamp, and step progress (e.g., "Step 3 of 7").
- From this view, users can **Resume**, **Delete**, or **Copy resume link** for any draft.
- Deleting a draft must require a single confirmation step.

### FR-7 — Expiry & Cleanup
- Expired drafts must be soft-deleted and retained for an additional configurable grace period (default: **7 days**) before permanent deletion, to allow recovery.
- When a user attempts to resume an expired session, the system must display a clear expiry message and offer the option to start a new session, pre-filled with any non-sensitive recoverable data if possible.
- Background jobs must purge permanently deleted drafts and associated storage on a scheduled basis (default: nightly).

### FR-8 — Security & Privacy
- Saved state must be encrypted at rest.
- Resume tokens must be single-ownership; sharing a link with another authenticated user must not grant that user access to the original user's draft.
- No sensitive credential or payment instrument data (full card numbers, passwords) may be persisted in draft state; these fields must always be re-entered on resume.
- Admins must not be able to view raw field-level draft content without explicit audit-logged access.

### FR-9 — Analytics & Observability
- The system must emit events for: `draft_created`, `draft_auto_saved`, `draft_manually_saved`, `draft_resumed`, `draft_completed`, `draft_abandoned` (expired without resume), `draft_deleted`.
- Drop-off step (the step at which a session was last saved before abandonment) must be queryable.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A user who closes the browser mid-flow and returns via the resume link lands on the exact step they left, with all data intact. |
| AC-2 | Auto-save fires within 5 seconds of the last input change without any visible UI disruption. |
| AC-3 | "Save & Exit" produces a working resume URL displayed to the user before they leave. |
| AC-4 | An authenticated user starting a previously saved flow sees the resume prompt before any data is overwritten. |
| AC-5 | A draft that has exceeded the 30-day inactivity threshold cannot be resumed; the user sees an expiry message. |
| AC-6 | No full payment card number or plaintext password appears in the persisted draft payload (verified by automated security scan of stored data). |
| AC-7 | "My Drafts" lists all active drafts and correctly reflects step progress and last-saved time. |
| AC-8 | Deleting a draft from "My Drafts" removes it from the list after a single confirmation; the resume link subsequently returns an expiry/not-found message. |
| AC-9 | All nine analytics events are emitted and queryable in the analytics platform. |
| AC-10 | Resume links work across different browsers and devices for both authenticated and unauthenticated users within the token validity window. |

---

## Out of Scope

- **Real-time collaborative editing** — multiple users editing the same draft simultaneously is not covered.
- **Version history / undo history** — only the latest saved state is preserved; rollback to earlier states within a session is not supported.
- **Offline / service-worker-based persistence** — resume works via server-side state only; offline-first PWA caching is a separate initiative.
- **Third-party SSO token refresh** — if a third-party auth token used mid-flow expires, re-authentication is handled by the existing auth system, not this feature.
- **Flow-specific business logic migration** — if the underlying flow schema changes after a draft is saved, migrating old drafts to the new schema is handled per-flow by the owning team.
- **Mobile native apps** — this PRD covers web only; native iOS/Android deep-link handling for resume URLs is a separate workstream.
- **SLA guarantees for auto-save under degraded network conditions** — graceful degradation behavior is noted but uptime guarantees are owned by the infrastructure SLA, not this feature.