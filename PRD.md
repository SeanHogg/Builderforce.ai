> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #258
> _Each agent that updates this PRD signs its change below._

# PRD: Diagnostic Interview System

## Problem & Goal

New users and returning stakeholders need a fast, structured way to surface project status, active risks, and priorities without manually digging through tickets, docs, or chat history. The system must ask the right questions in the right order, capture responses, and produce a concise diagnostic summary that any downstream agent or team member can act on immediately.

**Goal:** Deliver a conversational, structured interview flow that collects status, risk, and priority signals from a user and outputs a machine-readable + human-readable diagnostic report.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| Project / Product Manager | Rapid project health check at sprint boundaries or on-demand |
| Engineering Lead | Surface blockers and technical risks before stand-up or planning |
| Executive Sponsor | 5-minute situational awareness without reading full status reports |
| Onboarding Agent / AI Orchestrator | Structured input to feed downstream planning, risk, or prioritization agents |

---

## Scope

This PRD covers the **Diagnostic Interview module** — the question sequencing logic, response capture, validation, and report generation. It does not cover the downstream consumers of the report.

---

## Functional Requirements

### FR-1 — Interview Initialization
- The system MUST accept a context seed (project name, team, date, optional prior report) to personalize question phrasing.
- If no context seed is provided, the system MUST operate in "cold start" mode with generic but valid questions.

### FR-2 — Question Sequencing (Three Pillars)

#### FR-2a — Status Questions
- Collect: current phase/milestone, percentage complete (or equivalent signal), last completed deliverable, next scheduled deliverable.
- Minimum 2, maximum 6 questions; adapt count based on previous answers.

#### FR-2b — Risk Questions
- Collect: top 3 risks (prompted), likelihood and impact per risk (Low / Medium / High), any risk that has materialized since the last review.
- System MUST probe for risks not volunteered (e.g., dependencies, resourcing, technical debt) via at least one follow-up.

#### FR-2c — Priority Questions
- Collect: top priority item for the next 1–2 weeks, any priority changes since last review, any item that should be de-prioritized.
- System MUST surface conflicts if stated priorities contradict stated risks.

### FR-3 — Adaptive Follow-up
- If a user response is vague, incomplete, or contradictory, the system MUST ask exactly one clarifying follow-up before moving on.
- The system MUST NOT ask more than 2 consecutive clarifying questions on the same topic.

### FR-4 — Response Validation
- Required fields (current phase, at least one risk, top priority) MUST be populated before the interview closes.
- If a required field is skipped, the system MUST re-prompt once with a simplified version of the question.

### FR-5 — Diagnostic Report Generation
- Upon interview completion the system MUST generate a report containing:
  - **Header:** project name, date, interviewer/session ID
  - **Status Summary:** milestone, completion signal, next deliverable
  - **Risk Register:** each risk with likelihood, impact, and owner (if provided)
  - **Priority Table:** ranked items with rationale
  - **Conflict Flags:** any detected contradictions between status, risks, and priorities
  - **Recommended Next Actions:** ≤5 bullet points auto-generated from responses

### FR-6 — Output Formats
- Report MUST be available as structured JSON (for downstream agents) and rendered Markdown (for human readers).
- Both formats MUST be generated from the same canonical data model.

### FR-7 — Session Persistence
- Interview state MUST be saveable mid-session and resumable within 24 hours.
- Completed reports MUST be retrievable by session ID.

### FR-8 — Audit Trail
- All raw question/answer pairs MUST be stored and linkable to the final report for traceability.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | A cold-start interview reaches a valid completed report in ≤15 questions. |
| AC-2 | All three pillars (Status, Risk, Priority) are represented in every completed report. |
| AC-3 | Vague or single-word answers trigger exactly one clarifying follow-up per topic. |
| AC-4 | A report with at least one Conflict Flag is generated when a stated priority contradicts a stated High-impact risk. |
| AC-5 | JSON and Markdown outputs are generated within 3 seconds of interview completion. |
| AC-6 | A mid-session save can be resumed and completed with no data loss. |
| AC-7 | Session ID lookup returns the correct report 100% of the time within the 24-hour retention window. |
| AC-8 | Raw Q&A audit trail is complete and matches the final report for every session. |

---

## Out of Scope

- Integration with external project management tools (Jira, Linear, Asana) — future phase.
- Automatic scheduling or recurring interview triggers — future phase.
- Multi-user / simultaneous respondent sessions — single respondent per session only.
- Natural language processing training or model fine-tuning — consumers use the output; this module is prompt/logic-layer only.
- Role-based access control and authentication — handled by the host platform.
- Historical trend analysis across multiple sessions — covered by a separate Analytics PRD.