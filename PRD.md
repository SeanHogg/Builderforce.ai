> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #260
> _Each agent that updates this PRD signs its change below._

# PRD: Resolution Plan — AI-Generated Recommendations

## Problem & Goal

Support agents and team leads currently rely on tribal knowledge and manual triage to decide how to resolve customer issues, leading to inconsistent outcomes, longer handle times, and preventable escalations. The goal is to surface an AI-generated **Resolution Plan** at the point of need — a ranked, actionable set of recommendations that guides agents toward the most effective resolution path for each unique issue.

---

## Target Users / ICP Roles

| Role | Context |
|---|---|
| **Tier-1 Support Agent** | Primary consumer; views recommendations inline while handling a ticket |
| **Tier-2 / Senior Agent** | Reviews and overrides recommendations for complex cases |
| **Team Lead / QA Analyst** | Monitors recommendation quality, approval rates, and outcomes |
| **Support Operations Manager** | Tracks deflection rates, CSAT impact, and model performance |

---

## Scope

This feature is a **sub-deliverable of US-5 (AI Issue Analysis)** and covers:

- Generation of a structured Resolution Plan based on ticket content, customer context, and historical resolution data
- Display of the Resolution Plan within the existing ticket detail view
- Agent feedback loop (accept / reject / modify) to capture outcome signals
- Confidence scoring visible to agents and logged for model evaluation

Out-of-scope items are listed in the dedicated section below.

---

## Functional Requirements

### FR-1 — Plan Generation
- The system **must** generate a Resolution Plan automatically when a ticket reaches `Open` or `In Progress` status.
- The plan **must** contain between 1 and 5 ordered resolution steps, each including:
  - A plain-language action description (≤ 120 characters)
  - An action type tag (`REPLY`, `ESCALATE`, `REFUND`, `LINK_RESOURCE`, `CLOSE`, `OTHER`)
  - A confidence score (0.00 – 1.00) at the step level
- The plan **must** include an overall confidence score and a one-sentence rationale.

### FR-2 — Contextual Inputs
- The AI model **must** consume the following signals when available:
  - Full ticket text and subject
  - Customer tier, account age, and prior ticket history (last 90 days)
  - Product/category tags from US-5 issue classification
  - Agent-selected disposition from prior interactions
  - Resolved tickets with similar embeddings (top-5 nearest neighbors)

### FR-3 — Display & UX
- The Resolution Plan **must** be displayed in a dedicated **"Suggested Resolution"** panel within the ticket detail view, below the issue summary.
- Steps **must** be presented as a numbered checklist that agents can mark complete inline.
- Each step **must** show its confidence score visually (color-coded badge: green ≥ 0.75, amber 0.50–0.74, red < 0.50).
- The overall plan confidence and rationale **must** be collapsible to reduce visual noise.
- The panel **must** load within 3 seconds of ticket view render (p95).

### FR-4 — Agent Feedback Loop
- Agents **must** be able to take one of the following actions on the full plan:
  - **Accept** — followed the plan as presented
  - **Accept with Edits** — modified one or more steps before following
  - **Reject** — did not follow the plan (requires selection of a rejection reason from a predefined list)
- Agents **must** be able to flag individual steps as **Unhelpful** without rejecting the full plan.
- All feedback events **must** be written to the analytics event stream with ticket ID, agent ID, timestamp, and plan version.

### FR-5 — Refresh & Override
- Agents **must** be able to manually trigger a plan regeneration at any time via a **"Refresh Recommendations"** button.
- Regeneration **must** incorporate any new reply content or status changes made since the last generation.
- Each regeneration **must** produce a new versioned plan; prior versions **must** be retrievable via the audit log.

### FR-6 — Escalation Guardrails
- If the plan's top recommended step is `ESCALATE` with confidence ≥ 0.85, the system **must** pre-populate the escalation routing form with the suggested queue.
- If a `REFUND` step is present, the system **must** display a policy compliance reminder inline.

### FR-7 — Availability & Degradation
- If the AI service is unavailable or returns an error, the panel **must** display a graceful fallback message and **must not** block ticket interaction.
- The system **must** retry generation up to 2 times with exponential backoff before surfacing the fallback state.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | A Resolution Plan is generated and visible within the ticket detail view for 100% of tickets that transition to `Open` or `In Progress` status (excluding fallback error states). |
| AC-2 | The Suggested Resolution panel renders within 3 seconds at p95 under normal load. |
| AC-3 | Each plan contains 1–5 steps; every step includes action description, action type tag, and confidence score. |
| AC-4 | Color-coded confidence badges display correctly for all three threshold ranges across all supported browsers. |
| AC-5 | Agent feedback events (Accept, Accept with Edits, Reject, Unhelpful flag) are captured and present in the analytics event stream within 60 seconds of action. |
| AC-6 | Manual plan refresh incorporates ticket updates made after the prior generation and returns a new versioned plan. |
| AC-7 | When the AI service is unavailable, the ticket detail view remains fully functional and displays the fallback message without console errors. |
| AC-8 | Pre-population of the escalation routing form occurs when top step is `ESCALATE` with confidence ≥ 0.85. |
| AC-9 | A `REFUND` step triggers display of the policy compliance reminder in 100% of cases. |
| AC-10 | Plan version history is accessible in the audit log for any ticket that has had at least one refresh. |
| AC-11 | In A/B testing baseline, agents who receive Resolution Plans achieve a measurable improvement in first-contact resolution rate vs. control group within 30 days of rollout (threshold: +3 percentage points). |

---

## Out of Scope

- **Autonomous execution** of any resolution step without explicit agent action (no auto-replies, auto-refunds, or auto-closures)
- **Model training pipeline** changes or fine-tuning of the underlying LLM (handled by the ML Platform team separately)
- **Customer-facing display** of the Resolution Plan or any AI-generated rationale
- **Voice / telephony channel** integration (text-based tickets only in this release)
- **Multi-language plan generation** beyond English (internationalization deferred to a future release)
- **SLA or routing rule changes** triggered by plan output (integration with workflow automation is a future iteration)
- **Admin configuration UI** for adjusting confidence thresholds (thresholds are set via environment config by Support Ops in this release)