> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #262
> _Each agent that updates this PRD signs its change below._

# PRD: Prioritized Next Steps Panel with One-Click "Accept and Execute"

## Problem & Goal

Users working within the product accumulate context across conversations, analyses, and decisions but have no structured way to see what they should do next. They must mentally synthesize recommendations, copy them somewhere actionable, and then manually trigger follow-up work — creating friction, drop-off, and lost momentum.

**Goal:** Surface a prioritized, AI-generated list of next steps at the right moment and let users execute any single step instantly with one click, eliminating the gap between insight and action.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Product Manager** | Convert meeting notes / spec reviews into tracked action items without switching tools |
| **Engineer / Tech Lead** | Turn architectural decisions or code-review threads into queued tasks |
| **Analyst** | Move from data findings to follow-up queries or report drafts in one motion |
| **General Power User** | Reduce cognitive overhead when resuming work after any AI-assisted session |

---

## Scope

This covers the **Next Steps Panel** feature — a persistent or on-demand UI surface that presents AI-ranked action items derived from the current session context, each with a one-click execution pathway.

---

## Functional Requirements

### FR-1 — Next Steps Generation
- The system must analyze the current session (conversation history, open documents, prior outputs) and produce a ranked list of 3–7 next steps.
- Each step must include:
  - **Title** — ≤ 10 words, action-oriented (verb-first)
  - **Description** — 1–2 sentences explaining why this step is recommended
  - **Priority rank** — Urgent / High / Normal (AI-assigned, user-adjustable)
  - **Execution type** — one of: `run_query`, `draft_content`, `create_task`, `open_url`, `trigger_agent`, `ask_followup`
- Steps must regenerate automatically when session context changes materially (new message, document upload, major user action).
- Users can manually request a refresh via a **"Refresh suggestions"** button.

### FR-2 — One-Click Accept and Execute
- Each step card exposes a primary **"Accept & Execute"** button.
- On click, the system must:
  1. Mark the step as accepted (visual state change, logged event).
  2. Immediately invoke the mapped execution type without additional prompts (zero-modal-path for standard types).
  3. Show inline progress feedback within the card (spinner → success / error state).
- For execution types that produce output (`draft_content`, `run_query`), the result must appear in the main workspace or a linked artifact panel without full-page navigation.
- Execution must complete or surface a clear error within **10 seconds** for synchronous types; async types must show a live status indicator.

### FR-3 — Step Management
- Users can:
  - **Dismiss** a step (removes from list, logged, feeds negative signal to ranking model).
  - **Edit** title/description before executing.
  - **Re-order** steps via drag-and-drop.
  - **Pin** a step to keep it visible across session refreshes.
  - **Share** a step as a standalone task link (copies deep-link to clipboard).
- Accepted and dismissed steps collapse into a **"Completed / Skipped"** accordion at the bottom of the panel (not destroyed, auditable).

### FR-4 — Panel Placement & Trigger
- Panel is accessible via:
  - A persistent **sidebar icon** (collapsed by default on narrow viewports).
  - An inline **"See next steps"** call-to-action surfaced automatically after any high-value AI output (analysis complete, document generated, decision recorded).
- Panel state (open/closed, pinned steps) persists per session in local state and syncs to user preferences in backend.

### FR-5 — Prioritization Logic
- Default ranking is AI-determined using signals: recency of related context, detected blockers, dependency order, and estimated effort (low / medium / high).
- Effort estimate must be displayed as a pill badge on each card.
- Users can override priority rank; overrides persist for the session and are stored as preference signals for future personalization.

### FR-6 — Integrations for Execution Types
- `create_task` → must support at least **Jira**, **Linear**, and **native task list** at launch.
- `open_url` → opens in new tab; supports internal deep-links and external URLs.
- `trigger_agent` → invokes a registered sub-agent by ID; passes current session context as payload.
- `draft_content` / `run_query` / `ask_followup` → handled natively within the product's AI layer.

### FR-7 — Analytics & Feedback Loop
- Log per step: generated, viewed, accepted, dismissed, edited, execution success/failure.
- Expose a **thumbs up / down** micro-feedback control post-execution.
- Aggregate metrics (acceptance rate, execution success rate, time-to-execute) available in internal analytics dashboard.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a session with ≥ 1 AI output, the Next Steps panel generates a list of 3–7 prioritized steps within 3 seconds of panel open. |
| AC-2 | Clicking "Accept & Execute" on any step triggers the mapped action with no additional modal or confirmation screen for standard execution types. |
| AC-3 | Execution result (or live status) appears within 10 seconds for synchronous types; async types display a spinner with status text updating at least every 5 seconds. |
| AC-4 | Dismissing a step removes it from the active list immediately and it appears in the "Completed / Skipped" accordion. |
| AC-5 | Pinned steps survive a context refresh and are visually distinguished from unpinned steps. |
| AC-6 | `create_task` execution type successfully creates a task in Jira, Linear, or native task list and returns a confirmation link within the step card. |
| AC-7 | The panel renders correctly and is fully functional on viewport widths ≥ 375 px (mobile) through ≥ 1440 px (desktop). |
| AC-8 | All step events (generated, accepted, dismissed, executed, feedback) are captured in the analytics pipeline with ≤ 5-second ingestion lag. |
| AC-9 | A user with no session context (fresh session, no messages) sees an empty state with a prompt to start a conversation — no errors, no empty list. |
| AC-10 | Accessibility: panel and all interactive controls meet WCAG 2.1 AA; all buttons are keyboard-navigable and have appropriate ARIA labels. |

---

## Out of Scope

- **Native mobile app** (iOS / Android) — panel is web-only at launch; mobile web responsive support is in scope.
- **Multi-user / collaborative next steps** — steps are per-user, per-session only; team-shared step lists are a future milestone.
- **Scheduled / recurring steps** — execution is immediate; time-based scheduling is out of scope.
- **Billing or entitlement gating per step type** — all execution types available to all entitled users; per-step paywalling is a future consideration.
- **Custom execution type plugins** by end users — only pre-registered execution types are supported at launch.
- **Offline execution** — requires network connectivity; offline queuing is out of scope.
- **Email / Slack notification on step completion** — post-execution notifications are a future enhancement.