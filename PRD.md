> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #292
> _Each agent that updates this PRD signs its change below._

# PRD: Onboarding Wizard with Step-by-Step Question Flow

## Problem & Goal

New users who sign up for the product lack guided context-gathering at the start of their journey. Without structured onboarding, users either abandon setup early, configure the product incorrectly, or require manual support intervention. The goal is to ship a multi-step onboarding wizard that collects essential user information, personalizes the product experience, and delivers users to a meaningful "aha moment" as quickly as possible.

---

## Target Users / ICP Roles

| Role | Description |
|---|---|
| **New Registrant** | Any user who has just created an account and has not yet completed onboarding |
| **Returning Incomplete User** | A user who started onboarding but did not finish; must be able to resume from last completed step |
| **Admin / Workspace Owner** | May onboard on behalf of a team; answers include org-level questions |
| **Product & Growth Teams** | Internal stakeholders who configure wizard steps, view completion analytics, and iterate on question sets |

---

## Scope

### In Scope
- A linear, step-by-step question flow rendered as a full-page or modal wizard UI
- Minimum viable step types: single-select, multi-select, short text input, and role/persona picker
- Progress indicator (step X of N) visible at all times
- Ability to navigate backward to previous steps without losing answers
- Answer persistence (auto-save per step) so users can resume after closing the browser
- Conditional branching: subsequent steps may be shown or skipped based on prior answers
- Final confirmation / summary screen before submission
- Post-submission redirect to a personalized dashboard or "getting started" checklist
- Completion and drop-off event tracking emitted to the analytics pipeline
- Accessible UI meeting WCAG 2.1 AA

### Out of Scope
- *(See Out of Scope section below)*

---

## Functional Requirements

### FR-1 — Wizard Shell & Navigation
1. The wizard renders as a dedicated `/onboarding` route, protected by auth; unauthenticated users are redirected to sign-in.
2. A persistent header displays the product logo, current step number, total step count, and a visual progress bar.
3. A **Back** button appears from step 2 onward and returns the user to the previous step with their prior answer pre-filled.
4. A **Skip** button appears only on steps explicitly marked as optional in the step configuration.
5. Keyboard navigation (Tab, Enter, Arrow keys) must be fully functional for all input types.

### FR-2 — Step Types
| Type | Behavior |
|---|---|
| `single_select` | Renders 2–8 option cards; selecting one auto-advances after 300 ms delay |
| `multi_select` | Renders 2–12 checkbox-style option cards; requires explicit **Continue** button |
| `text_input` | Single-line or multi-line text field with optional character limit; **Continue** enabled after ≥1 non-whitespace character |
| `persona_picker` | Specialized single-select with icon, title, and description per option |

### FR-3 — Conditional Branching
1. Each step configuration may include a `show_if` rule referencing a prior step ID and expected answer value(s).
2. Steps whose `show_if` condition is not met are silently skipped; the progress bar denominator updates accordingly.
3. Branching logic must be evaluated client-side in real time as answers change.

### FR-4 — Answer Persistence & Resume
1. Answers are saved to the backend after each step is completed (fire-and-forget with retry on failure).
2. On returning to `/onboarding`, the wizard loads saved answers and advances the user to the first incomplete step.
3. If a user changes a previous answer that invalidates a branch, all downstream dependent answers are cleared.

### FR-5 — Summary & Submission
1. The final step is a read-only summary listing all question labels and user answers.
2. Users may click **Edit** on any summary row to jump back to that specific step.
3. A **Complete Setup** CTA submits all answers to the onboarding API endpoint.
4. On successful submission the user is redirected within 1 second; on failure a non-blocking error toast appears and the button remains active for retry.

### FR-6 — Personalization Handoff
1. The backend onboarding service stores wizard answers against the user profile.
2. A `POST /api/onboarding/complete` call triggers downstream personalization logic (dashboard layout, recommended features, welcome email).
3. Users who have completed onboarding and visit `/onboarding` are redirected to the main dashboard.

### FR-7 — Analytics Events
| Event | Trigger | Key Properties |
|---|---|---|
| `onboarding_started` | Wizard loads for the first time | `user_id`, `timestamp` |
| `onboarding_step_completed` | User advances past a step | `user_id`, `step_id`, `step_index`, `answer_value` |
| `onboarding_step_back` | User navigates backward | `user_id`, `from_step_id`, `to_step_id` |
| `onboarding_skipped_step` | User clicks Skip | `user_id`, `step_id` |
| `onboarding_completed` | Successful submission | `user_id`, `total_time_seconds`, `steps_completed` |
| `onboarding_abandoned` | Session ends before completion | `user_id`, `last_step_id` |

### FR-8 — Admin Configuration
1. Wizard steps are defined in a JSON/YAML configuration file or CMS entry; no code deploy required to reorder or add steps.
2. Each step object includes: `id`, `type`, `question_text`, `helper_text` (optional), `options` (for select types), `required` (bool), `show_if` (optional), `skip_label` (optional).
3. Configuration changes take effect on next wizard load without requiring a client cache bust.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | A brand-new user who signs up and visits the app is automatically redirected to `/onboarding`. |
| AC-02 | The progress bar accurately reflects the number of steps relevant to the user's branch path. |
| AC-03 | Answers entered on step 3, followed by browser close and re-open, are present and the user lands on step 4. |
| AC-04 | A step with `show_if: { step_id: "role", values: ["developer"] }` is rendered only when the user selects "developer" on the role step. |
| AC-05 | Submitting the final step with all required fields answered results in a 200 response and redirect to `/dashboard` within 1 second. |
| AC-06 | A failed submission (500 response) shows an error toast; the wizard does not navigate away and data is not lost. |
| AC-07 | All interactive elements pass automated accessibility audit (axe-core, zero critical violations). |
| AC-08 | `onboarding_completed` event appears in the analytics stream within 5 seconds of successful submission. |
| AC-09 | A user who has already completed onboarding and navigates to `/onboarding` is immediately redirected to `/dashboard`. |
| AC-10 | The wizard renders correctly and is fully operable on Chrome, Firefox, Safari, and Edge (latest two versions each) at 375 px and 1280 px viewport widths. |
| AC-11 | Changing an answer on a prior step that invalidates a conditional branch clears the previously stored answer for the now-hidden step. |
| AC-12 | Step configuration can be updated without a code deployment and the change is reflected on the next wizard load. |

---

## Out of Scope

- Multi-language / i18n support (planned for a future iteration)
- A/B testing of question sets within the wizard itself (analytics foundation is laid; experimentation layer is separate)
- In-wizard video or rich media embeds
- Team / collaborative onboarding where multiple users fill out the wizard together simultaneously
- Administrative UI for editing step configuration (config is file or CMS-based; a visual editor is a separate workstream)
- Onboarding wizard for mobile native apps (iOS / Android)
- Re-triggering or resetting the completed onboarding flow for existing users (handled by a separate "re-onboarding" feature)
- SLA or uptime guarantees specific to the onboarding service beyond the platform baseline