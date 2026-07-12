> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #267
> _Each agent that updates this PRD signs its change below._

# PRD: End-to-End Onboarding Wizard (8 Steps)

## Problem & Goal

New users who sign up for the product experience high drop-off rates and time-to-value delays because there is no guided setup flow. They must discover configuration options, integrations, and key features on their own, leading to incomplete profiles, missed activations, and early churn.

**Goal:** Build a linear, resumable, 8-step onboarding wizard that guides a newly registered user from account creation to their first meaningful action ("aha moment") within a single session, while collecting the data the product needs to personalize the experience.

---

## Target Users / ICP Roles

| Role | Description |
|---|---|
| **New End User** | Just completed registration; has never used the product before. Primary actor walking through all 8 steps. |
| **Admin / Account Owner** | May onboard on behalf of a team; needs workspace and member configuration steps. |
| **Returning Incomplete User** | Started onboarding in a previous session but did not finish; must be able to resume from last completed step. |

---

## Scope

### In Scope
- All 8 onboarding wizard steps (defined below)
- Progress persistence (resume from last completed step)
- Step-level validation before advancing
- Skip logic for optional steps
- Completion state that unlocks the main application dashboard
- Redirect to wizard for users whose onboarding is incomplete
- Analytics events fired at each step start, completion, and skip
- Mobile-responsive layout

### Out of Scope
- In-app product tours or tooltips after onboarding completes
- Re-onboarding or onboarding reset flows
- Onboarding for existing users migrated from a legacy system
- Native mobile (iOS/Android) implementations
- A/B test variants of step ordering (future phase)

---

## Functional Requirements

### Global / Wizard Shell

| ID | Requirement |
|---|---|
| FR-G1 | The wizard shell renders a persistent step indicator showing all 8 steps, current step, and completed steps. |
| FR-G2 | Progress is saved to the backend after each successful step submission so the user can resume on any device. |
| FR-G3 | Navigating away mid-wizard shows a confirmation dialog warning that unsaved changes on the current step will be lost. |
| FR-G4 | The "Back" button is available on steps 2–8 and returns the user to the previous step without data loss. |
| FR-G5 | The wizard is fully keyboard-navigable and meets WCAG 2.1 AA accessibility standards. |
| FR-G6 | A "Save & Exit" option is available at all steps, preserving completed step data and redirecting to a holding page. |
| FR-G7 | On next login, an incomplete user is automatically redirected to their last incomplete step. |

---

### Step 1 — Welcome & Goal Selection

| ID | Requirement |
|---|---|
| FR-1.1 | Display a welcome message personalized with the user's first name. |
| FR-1.2 | Present 3–6 selectable primary use-case goals (e.g., "Manage projects", "Track sales pipeline"). |
| FR-1.3 | User must select at least one goal before proceeding; multi-select is allowed. |
| FR-1.4 | Selected goals are stored and used to conditionally configure defaults in later steps. |

---

### Step 2 — Profile Setup

| ID | Requirement |
|---|---|
| FR-2.1 | Collect: full name, job title, and profile photo (photo is optional). |
| FR-2.2 | Full name and job title are required fields with inline validation. |
| FR-2.3 | Profile photo upload supports JPG, PNG, and WEBP up to 5 MB; display a cropping tool on upload. |
| FR-2.4 | Pre-populate full name from registration data if available. |

---

### Step 3 — Workspace / Organization Setup

| ID | Requirement |
|---|---|
| FR-3.1 | Collect workspace name and optionally upload a workspace logo. |
| FR-3.2 | Workspace name must be unique within the platform; display real-time availability feedback. |
| FR-3.3 | Allow the user to select their organization size from a predefined list (1–10, 11–50, 51–200, 200+). |
| FR-3.4 | Workspace name is required; logo and org size are optional. |

---

### Step 4 — Invite Team Members

| ID | Requirement |
|---|---|
| FR-4.1 | Provide an email input that accepts multiple comma- or newline-separated email addresses. |
| FR-4.2 | Validate each email format inline; highlight invalid entries before allowing submission. |
| FR-4.3 | Allow the user to assign a role (Admin, Member, Viewer) to all invitees collectively or individually. |
| FR-4.4 | This step is skippable; a "Skip for now" link must be clearly visible. |
| FR-4.5 | On submission, send invitation emails immediately; display a success confirmation listing invited addresses. |

---

### Step 5 — Integrations & Connections

| ID | Requirement |
|---|---|
| FR-5.1 | Display an integration catalog filtered to 4–8 recommended integrations based on the goals selected in Step 1. |
| FR-5.2 | Each integration card shows: name, logo, one-line description, and a "Connect" / "Skip" action. |
| FR-5.3 | Connecting an integration opens an OAuth or API-key modal within the wizard without navigating away. |
| FR-5.4 | Connected integrations display a "Connected ✓" badge. |
| FR-5.5 | The entire step is skippable; at least zero integrations may be connected to proceed. |
| FR-5.6 | Connection status is persisted immediately upon successful OAuth callback. |

---

### Step 6 — Configure Notifications & Preferences

| ID | Requirement |
|---|---|
| FR-6.1 | Present notification preference toggles for: email digest (daily/weekly/off), in-app notifications (on/off), and mobile push if applicable (on/off). |
| FR-6.2 | Default values are pre-selected to recommended settings; user may change any toggle. |
| FR-6.3 | Include a timezone selector pre-populated by browser locale detection. |
| FR-6.4 | All fields have defaults; the user may proceed without changing anything. |

---

### Step 7 — Product Personalization / Feature Highlights

| ID | Requirement |
|---|---|
| FR-7.1 | Display 2–4 feature highlights dynamically chosen based on goals from Step 1. |
| FR-7.2 | Each highlight includes: feature name, illustration or short (≤15 s) looping video, and a one-sentence value statement. |
| FR-7.3 | User must view (scroll past or wait for video completion) each highlight before the "Next" button activates — minimum dwell of 3 seconds per card. |
| FR-7.4 | This step is informational only; no data collection is required to proceed. |

---

### Step 8 — Summary & First Action (Launch)

| ID | Requirement |
|---|---|
| FR-8.1 | Display a summary of all key choices made: goals, workspace name, invited members count, connected integrations. |
| FR-8.2 | Present a single primary CTA ("Create your first [object]") tailored to the primary goal selected in Step 1. |
| FR-8.3 | Clicking the primary CTA marks onboarding as `completed` in the backend, fires a `onboarding_completed` analytics event, and redirects to the relevant feature in the main dashboard. |
| FR-8.4 | A secondary link "Go to Dashboard" allows skipping the first action while still marking onboarding as completed. |
| FR-8.5 | Confetti or equivalent celebratory micro-animation plays on step load. |

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | A brand-new user can complete all 8 steps sequentially and land on the dashboard in a single session without errors. |
| AC-02 | A user who exits after Step 3 and logs in again is taken directly to Step 4 with Steps 1–3 data intact. |
| AC-03 | Submitting Step 3 with a duplicate workspace name surfaces an inline error and prevents advancement. |
| AC-04 | Inviting team members in Step 4 results in invitation emails delivered within 2 minutes; invited users appear as "Pending" in workspace settings. |
| AC-05 | Connecting an integration in Step 5 via OAuth completes without leaving the wizard, and the "Connected ✓" badge appears within 3 seconds of callback. |
| AC-06 | Skipping all optional steps (4, 5) still results in a fully `completed` onboarding state after Step 8. |
| AC-07 | All 8 steps render correctly and are fully operable on Chrome, Firefox, Safari (latest), and a 375 px-wide mobile viewport. |
| AC-08 | All analytics events (`step_started`, `step_completed`, `step_skipped`, `onboarding_completed`) are present in the event stream for a completed run. |
| AC-09 | The wizard passes an automated WCAG 2.1 AA audit with zero critical violations. |
| AC-10 | Page load time for each wizard step is under 2 seconds on a simulated 4G connection (Lighthouse throttling). |
| AC-11 | No step allows the user to advance while required fields are empty or invalid. |
| AC-12 | The "Back" button at Step 5 returns the user to Step 4 with previously entered email addresses preserved. |

---

## Out of Scope

- Post-onboarding in-app product tours, tooltips, or coach marks
- Onboarding analytics dashboard or reporting UI
- Admin-side ability to customize or reorder wizard steps
- SSO / SAML configuration during onboarding
- Billing or subscription plan selection (handled in a separate checkout flow)
- Re-onboarding flow for existing users
- Native iOS and Android implementations
- Offline or low-connectivity graceful degradation beyond standard browser behavior
- Localization / i18n beyond English (planned for a future phase)
- Automated onboarding via API (headless / programmatic setup)