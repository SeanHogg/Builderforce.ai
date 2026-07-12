> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #272
> _Each agent that updates this PRD signs its change below._

# PRD: "Quick Start" Mode for Experienced Users

## Problem & Goal

New and returning users are funneled through the same onboarding flow regardless of their familiarity with the product. Experienced users are forced to click through introductory screens, tooltips, and guided walkthroughs before reaching the core diagnostic functionality they need. This creates friction, wastes time, and signals a lack of respect for user expertise.

**Goal:** Introduce a "Quick Start" mode that allows experienced or returning users to bypass onboarding and land directly in the diagnostic workflow, reducing time-to-value to under 10 seconds from login.

---

## Target Users / ICP Roles

| Role | Description |
|---|---|
| **Power Users** | Returning users who have completed onboarding at least once and use the product regularly (≥ 3 sessions/week) |
| **Technical Practitioners** | Engineers, analysts, or clinicians who arrive with domain knowledge and do not require conceptual orientation |
| **Enterprise Users** | Users provisioned via SSO or bulk admin invite who have received offline training and need no in-app orientation |
| **Returning Trial Users** | Users who have previously completed a trial and are re-engaging or upgrading |

---

## Scope

This PRD covers the detection, activation, and persistence of Quick Start mode. It does not cover changes to the diagnostic feature itself.

**In scope:**
- Quick Start mode toggle (user-controlled and system-suggested)
- Onboarding bypass routing logic
- Persistent user preference storage
- Surfacing a lightweight "restore guidance" option for users who want it back
- Analytics instrumentation for mode adoption and task completion

**Out of scope:**
- Changes to diagnostic feature UX or functionality
- Admin-level enforcement of Quick Start for entire organizations (future phase)
- Redesign of the standard onboarding flow
- Mobile-native implementations (web-first)

---

## Functional Requirements

### FR-1: Mode Detection & Suggestion
- The system must detect qualifying experienced users based on at least one of the following signals:
  - User has previously completed the standard onboarding flow
  - User account age > 14 days with ≥ 3 recorded sessions
  - User was provisioned via SSO enterprise integration
- When a qualifying user logs in and the standard onboarding flow would otherwise trigger, the system must present a dismissible prompt offering Quick Start mode before any onboarding screen renders.

### FR-2: Quick Start Activation
- The prompt must display two clear calls-to-action: **"Quick Start"** and **"Take the Tour"**.
- Selecting "Quick Start" must immediately route the user to the diagnostic landing screen, skipping all onboarding steps.
- Selecting "Take the Tour" must proceed with the standard onboarding flow with no changes.
- The choice must be recorded on the user profile and used on all subsequent logins.

### FR-3: Manual Toggle in User Settings
- All users (not only qualifying users) must be able to enable or disable Quick Start mode from their account Settings page under a clearly labeled section (e.g., "Startup Preferences").
- The toggle must take effect on the next login session.

### FR-4: Restore Guidance Option
- Users in Quick Start mode must have persistent, non-intrusive access to relaunch the onboarding tour from within the product (e.g., via Help menu → "Restart Guided Tour").
- Relaunching the tour must not disable Quick Start mode permanently; it must be a one-time walkthrough trigger.

### FR-5: Routing Logic
- Quick Start mode must route the user to the diagnostic home screen as the authenticated landing page.
- Deep links and URL-based routing (e.g., a shared diagnostic link) must take precedence over Quick Start routing.
- If the user's account is incomplete (missing required profile fields, unpaid subscription, etc.), the relevant completion screen must take precedence over Quick Start routing.

### FR-6: Analytics & Instrumentation
- The following events must be tracked with user ID and timestamp:
  - `quickstart_prompt_shown`
  - `quickstart_selected`
  - `tour_selected_from_prompt`
  - `quickstart_toggled_on` (settings)
  - `quickstart_toggled_off` (settings)
  - `guided_tour_relaunched`
- A dashboard metric must report the Quick Start adoption rate (Quick Start selections / total prompt impressions) weekly.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | A qualifying returning user who has completed onboarding reaches the diagnostic screen within 2 clicks and ≤ 10 seconds of login. |
| AC-02 | The Quick Start prompt appears before any onboarding screen is rendered for qualifying users. |
| AC-03 | A user who selects "Take the Tour" from the prompt experiences the standard onboarding flow with zero modifications. |
| AC-04 | The user's Quick Start preference persists across sessions, browsers, and devices when logged into the same account. |
| AC-05 | A non-qualifying new user does not see the Quick Start prompt on first login. |
| AC-06 | A user with an incomplete required profile is shown the profile completion screen regardless of Quick Start mode status. |
| AC-07 | The "Restart Guided Tour" action in the Help menu successfully launches the onboarding tour and does not alter the user's saved Quick Start preference. |
| AC-08 | All six analytics events fire correctly and are visible in the analytics dashboard within 5 minutes of occurrence. |
| AC-09 | The Settings toggle correctly enables and disables Quick Start for users who were not shown the automatic prompt. |
| AC-10 | SSO-provisioned enterprise users have Quick Start mode enabled by default on first login without needing to interact with the prompt. |

---

## Out of Scope

- **Admin-enforced Quick Start** for all users within an organization — targeted for a follow-on release with admin controls.
- **Diagnostic UX changes** — the diagnostic screen itself is unchanged; this PRD only governs routing to it.
- **Standard onboarding redesign** — no modifications to the existing tour content, flow, or triggers for non-Quick-Start users.
- **Mobile native apps (iOS/Android)** — Quick Start mode will ship web-first; mobile parity is a separate workstream.
- **A/B testing framework** — instrumentation is included, but experiment configuration and holdout groups are owned by the Growth team under a separate initiative.
- **Offline or embedded product contexts** — behavior in white-labeled or embedded deployments is not defined here.