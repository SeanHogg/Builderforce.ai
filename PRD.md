> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #336
> _Each agent that updates this PRD signs its change below._

# PRD: Recommendations for Missing Integrations

## Problem & Goal

Users of the platform lack visibility into third-party tools and services they are not yet connected to but would benefit from. This creates friction in adoption, leaves value on the table, and increases churn risk as users may not realize the platform can integrate with tools already in their workflow.

**Goal:** Surface contextually relevant integration recommendations to users who have not yet connected available third-party services, increasing integration adoption rate and deepening platform stickiness.

---

## Target Users / ICP Roles

| Role | Description |
|---|---|
| **Platform Admins** | Responsible for configuring integrations across the organization; need a clear view of what is available vs. installed |
| **Power Users / Operators** | Day-to-day users who trigger workflows; benefit from integrations that reduce manual effort |
| **New Users (Onboarding)** | Recently activated accounts with few or no integrations connected; highest opportunity for first-time adoption |
| **Customer Success Managers (Internal)** | Monitor integration health per account and use recommendations data to drive expansion conversations |

---

## Scope

This feature covers the discovery and recommendation layer for missing integrations within the platform's existing integration marketplace or settings surface. It includes:

- Identifying which integrations are available but not installed for a given user or workspace
- Generating and ranking recommendations based on contextual signals
- Displaying recommendations in appropriate in-product surfaces
- Tracking engagement with recommendations (impressions, clicks, installs)

---

## Functional Requirements

### FR-1: Integration Gap Detection
- The system must compare the full catalog of available integrations against the set of integrations currently active for a given workspace.
- Gap data must refresh in real time or near real time (≤ 5 minutes) when a new integration is connected or disconnected.

### FR-2: Recommendation Engine
- The system must rank uninstalled integrations by relevance score computed from one or more of the following signals:
  - **Usage patterns:** Features or workflows the user has already engaged with that commonly pair with a given integration
  - **Peer adoption:** Integrations popular among accounts with similar industry, team size, or plan tier
  - **Admin-curated rules:** Manually configured rules that promote or suppress specific integrations per segment
  - **Recency / trending:** Integrations with recent high install velocity across the platform
- The engine must return a ranked list of up to 10 recommendations per user session.

### FR-3: Recommendation Display Surfaces
- Recommendations must appear in at least the following surfaces:
  1. **Integration marketplace / directory** — highlighted "Recommended for You" section at the top
  2. **Onboarding checklist** — surfaced as an optional step after core setup tasks
  3. **In-context nudges** — inline banners or tooltips on feature pages where a missing integration is directly relevant (e.g., CRM integration prompt on the Contacts page)
- Each recommendation card must display: integration name, logo, one-line value proposition, and a primary CTA ("Connect" or "Learn More").

### FR-4: Dismissal and Feedback
- Users must be able to dismiss any individual recommendation ("Not interested").
- Dismissed recommendations must not reappear for at least 30 days unless the user explicitly resets preferences.
- An optional single-tap reason picker must be offered on dismissal (e.g., "Already use a different tool," "Not relevant," "Will set up later").

### FR-5: Admin Controls
- Workspace admins must be able to:
  - Pin up to 3 integrations to always appear at the top of the recommended list for their workspace
  - Suppress specific integrations from ever appearing in recommendations for their workspace
  - View an aggregated report of which integrations have been recommended, clicked, and installed within their workspace

### FR-6: Analytics & Instrumentation
- The following events must be tracked and available in the internal analytics pipeline:
  - `recommendation_impression` (integration_id, surface, user_id, timestamp)
  - `recommendation_click` (integration_id, surface, user_id, timestamp)
  - `recommendation_dismissed` (integration_id, surface, reason, user_id, timestamp)
  - `integration_installed_from_recommendation` (integration_id, surface, user_id, timestamp)
- A/B testing hooks must be supported so recommendation algorithms can be experimented on independently per surface.

### FR-7: Notification Channel (Phase 1 — Email)
- A weekly digest email must be sent to workspace admins who have 3 or more unconnected recommended integrations.
- Email must be suppressible at the user level via standard unsubscribe.
- Email send logic must respect global communication frequency caps.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a workspace with at least one available but uninstalled integration, the recommendation endpoint returns a non-empty ranked list of up to 10 items within 300 ms (p95). |
| AC-2 | Recommendations shown in the marketplace "Recommended for You" section are limited to integrations not already active in the workspace. |
| AC-3 | A dismissed recommendation does not reappear on any surface for the same user within 30 calendar days. |
| AC-4 | Clicking "Connect" on a recommendation card navigates the user to the correct integration auth/setup flow and fires a `recommendation_click` event. |
| AC-5 | After a successful install originating from a recommendation card, an `integration_installed_from_recommendation` event is recorded with the correct `surface` and `integration_id`. |
| AC-6 | Admin pin and suppress controls take effect within one page reload for all users in the workspace (≤ 5-minute cache TTL). |
| AC-7 | The weekly digest email is sent only to admins with ≥ 3 unconnected recommended integrations, and includes an unsubscribe link that resolves within one click. |
| AC-8 | In-context nudges are rendered only on the feature pages mapped to a given integration; no nudge appears on an unrelated page. |
| AC-9 | The recommendation engine falls back gracefully (showing a default popularity-ranked list) when insufficient signal data exists for a workspace (e.g., new accounts < 7 days old). |
| AC-10 | All recommendation surfaces pass WCAG 2.1 AA accessibility checks for color contrast, keyboard navigation, and screen reader labels. |

---

## Out of Scope

- **Building new integrations** — this feature is about surfacing and recommending existing catalog integrations only.
- **Cross-platform / external recommendations** — suggesting tools not in the integration catalog or external app stores.
- **Pricing or upsell logic** — recommendations will not be gated or influenced by plan-upgrade prompts in this phase; that is handled by the Monetization team.
- **Mobile native apps** — recommendation surfaces are web-only in this phase; mobile surfaces are deferred to a follow-on milestone.
- **Automated integration setup** — the feature recommends and navigates users to the setup flow but does not auto-configure or pre-fill credentials.
- **Integration health monitoring** — alerting on broken or degraded connected integrations is owned by the Integrations Reliability team.
- **Personalization model retraining pipeline** — data science infrastructure for model training is managed by the ML Platform team; this PRD covers the serving/display layer only.