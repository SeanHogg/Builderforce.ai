> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #322
> _Each agent that updates this PRD signs its change below._

# PRD: Specific, Actionable, Data-Linked Recommendations Engine

## Problem & Goal

Current recommendations surfaced to users are generic, vague, and disconnected from the actual state of their project data. Users cannot tell what to do next, why it matters, or how the suggestion connects to their work. This erodes trust and reduces engagement with the recommendations feature.

**Goal:** Deliver recommendations that are specific (scoped to the user's exact context), actionable (tell the user precisely what to do), and traceable (linked directly to the underlying project data that triggered them).

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Project Manager** | Prioritize blockers and risks across tasks, milestones, and team members |
| **Individual Contributor** | Know the single most important thing to act on right now |
| **Team Lead / Engineering Manager** | Identify systemic patterns across multiple contributors or sprints |
| **Executive Sponsor** | Understand high-level risks without drilling into raw data |

---

## Scope

### In Scope
- Recommendation generation pipeline that reads from live project data (tasks, statuses, deadlines, assignees, dependencies, comments, and activity logs)
- Recommendation cards displayed in the product UI
- Data linking: each recommendation references the specific records, fields, or events that triggered it
- Action affordances attached to each recommendation (e.g., a button or deep link that initiates the action)
- Confidence/priority scoring per recommendation
- Dismissal and feedback mechanism (thumbs up / thumbs down + optional free text)

### Out of Scope
- Predictive forecasting or machine learning model training (first version uses rule-based and heuristic logic)
- Email or push notification delivery of recommendations
- Cross-organization or benchmark-based recommendations
- Recommendations sourced from integrations outside the core project data model (e.g., Slack, GitHub) in v1

---

## Functional Requirements

### FR-1 — Recommendation Generation
1. The system must evaluate project data on a defined trigger cadence (real-time event-driven **and** scheduled batch, minimum every 15 minutes).
2. Each recommendation must be generated from at least one named rule or heuristic (e.g., `OVERDUE_DEPENDENCY`, `UNASSIGNED_BLOCKER`, `STALE_MILESTONE`).
3. Rules must be configurable by the engineering team without a full deployment (feature-flagged rule registry).
4. Duplicate or near-duplicate recommendations for the same root cause must be deduplicated before surfacing.

### FR-2 — Specificity
1. Every recommendation must reference the specific entity that triggered it: task ID, milestone name, user name, or deadline date — never a generic class of items.
2. Recommendation headline must be ≤ 120 characters and name the specific item (e.g., *"Task #482 'API Auth' is blocking 3 downstream tasks due today"*).
3. A supporting detail section (≤ 300 characters) must explain the specific condition detected.

### FR-3 — Actionability
1. Every recommendation must include at least one primary action affordance (CTA button or deep link).
2. The CTA must navigate the user directly to the relevant record or initiate the relevant workflow (reassign, update status, add due date, etc.) in ≤ 2 clicks from the recommendation card.
3. Actions must be executable inline where the target workflow supports it (e.g., reassigning an unassigned task without leaving the recommendations panel).
4. Each recommendation must include a "Why this matters" sentence that explains the downstream impact of taking or not taking the action.

### FR-4 — Data Linkage
1. Each recommendation card must display a visible link or expandable reference to every project record that contributed to the recommendation.
2. Clicking a linked record must open that record in the product without losing recommendation context (e.g., opens in a side panel or new tab).
3. The system must log which data fields and values were used to generate each recommendation for auditability.
4. If the linked source data changes (e.g., task is completed), the recommendation must be automatically invalidated or updated within one trigger cycle.

### FR-5 — Prioritization & Ranking
1. Recommendations must be ranked and displayed in descending order of calculated priority score.
2. Priority score must account for: urgency (time to deadline), impact (number of downstream items affected), and recency (how recently the triggering condition appeared).
3. Users must be able to filter recommendations by category (Risk, Action Required, FYI) and by project/team.

### FR-6 — Feedback & Dismissal
1. Users can dismiss any recommendation; dismissed recommendations must not reappear unless the underlying data changes materially.
2. Users can provide a thumbs-up / thumbs-down signal and optional free-text reason per recommendation.
3. Feedback data must be stored and accessible to the product analytics team in the data warehouse within 24 hours.

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | Every recommendation card references at least one specific named project entity (task, milestone, user, or date) | QA audit of 50 generated recommendations across 5 test projects — 0 generic recommendations permitted |
| AC-2 | Every recommendation card has a functional primary CTA that reaches the target record or workflow in ≤ 2 clicks | Manual click-path testing on all CTA types |
| AC-3 | Linked source records are visible on the card and navigate correctly | Automated link-integrity tests run on each build |
| AC-4 | A recommendation is invalidated or updated within 15 minutes of its source data resolving | End-to-end test: mark source task complete, confirm recommendation disappears within 15 min |
| AC-5 | Recommendations are ranked; highest-priority item appears first for a project with known seeded data | Automated test with deterministic seed data asserting sort order |
| AC-6 | Dismissed recommendations do not reappear when source data is unchanged after 7 days | Automated regression test |
| AC-7 | Thumbs-up/down feedback is recorded and visible in the data warehouse within 24 hours | Data pipeline smoke test post-deploy |
| AC-8 | No recommendation headline exceeds 120 characters | Automated character-length assertion in recommendation renderer unit tests |
| AC-9 | System surfaces at least one valid recommendation within 15 minutes for a newly created project that meets any active rule condition | Integration test with seeded project |
| AC-10 | Page load time for the recommendations panel with ≤ 50 cards is under 2 seconds (p95) | Load test in staging environment |

---

## Out of Scope

- ML model training, fine-tuning, or inference for recommendation generation (v1 is rule/heuristic-based only)
- Email, Slack, or push notification delivery channels
- Recommendations derived from third-party integrations (GitHub commits, Jira, Slack messages) in v1
- Admin UI for non-engineering users to create or edit recommendation rules
- Personalization based on individual user behavioral history (considered for v2)
- Multi-language / localization of recommendation text
- Benchmark comparisons against external or cross-organization project data
- SLA guarantees on recommendation generation outside of the 15-minute batch cadence