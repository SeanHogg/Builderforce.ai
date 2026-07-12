> **PRD** — drafted by Validator · task #503
> _Each agent that updates this PRD signs its change below._

# PRD: Stakeholder Alignment Diagnostic — Category 6 (Epic #155)

## Problem & Goal

**Problem:** Projects slip due to hidden stakeholder misalignment: priorities are not explicitly agreed, two stakeholders submit different P0s for the same team, required approvers are stale/missing, conflicts sit >48h without sign-off, and current plans drift from agreed priorities. There is no systematic diagnostic to detect this.

**Goal:** Implement Category 6 (Stakeholder Alignment) of the Diagnostic Question Engine as a first-pass spec. This pass defines the canonical questions, branching logic, data models, and rules wiring required for downstream implementation. Outputs must be persisted to a structured health profile attached to the project and feed escalation and reporting.

This PRD covers task creation and specification for sub-tasks **504-508**, to be implemented in the subsequent turn.

## Target Users / ICP Roles

*   **Primary - Diagnostic Runner:** Program / Delivery Lead, Product Manager running the health check.
*   **Secondary - Stakeholders:** Eng Lead, Product Lead, Design Lead, GTM Lead who submit P0s and must sign-off.
*   **Tertiary - Approvers / Leadership:** Directors/VPs in escalation chains.
*   **System - Diagnostic Engine:** Service that evaluates rules, state machine, and generates digests.

## Scope

**In Scope (First Pass Spec):**

*   Task 504: Canonical Questions, Branching Logic, Health Profile Schema
*   Task 505: Stakeholder Map & Required Approvers Registry
*   Task 506: Conflict Detection Rules Engine
*   Task 507: Sign-off Protocol State Machine & Escalation Path + Reminders
*   Task 508: Reporting Dashboard (metrics) & Weekly Digests
*   Wiring definitions only — data models, interfaces, state transitions, SLAs, and acceptance criteria for implementation in next turn.

## Functional Requirements

### FR1: Canonical Questions (Task 504)
*   System MUST provide 5 canonical questions for Category 6:
    1.  Are priorities clear and agreed across stakeholders?
    2.  Are competing P0s reconciled?
    3.  Are required approvers current and complete?
    4.  Have any active conflicts exceeded 48hr without sign-off?
    5.  Does the current plan / roadmap reflect the agreed priorities?
*   Each question: `id`, `text`, `type` (boolean + evidence link), `weight`, `required_evidence`.
*   All answers save to `project.health_profile.stakeholder_alignment`.

### FR2: Branching Logic (Task 504)
*   If Q1 == No OR Q4 == Yes (overdue >48h) -> require Q2 and trigger conflict scan.
*   If conflict detection finds active conflict -> require Q4 evidence and force sign-off protocol to `Blocked`.
*   If Q3 == No (approvers stale) -> branch to remediation: prompt to update stakeholder map before survey close.

### FR3: Health Profile Persistence (Task 504)
*   `HealthProfile` attached to `Project`: `project_id`, `category_scores.stakeholder_alignment`, `answers[]`, `last_run_at`, `active_conflicts[]`, `approver_coverage %`, `escalation_status`.
*   Structured, versioned JSON with audit history.

### FR4: Stakeholder Map (Task 505)
*   Per project/team: list of stakeholders with `user_id`, `role`, `is_required_approver`, `team_scope`, `p0_submission {p0_id, text, submitted_at}`, `is_active`.
*   Supports review window config, default 7 days.
*   Required approvers registry must be current-checked: stale if >30 days since confirmation or user deactivated.

### FR5: Conflict Detection Rules (Task 506)
*   **Rule 1 - Competing P0s:** IF two distinct stakeholders with `is_active=true` submit different P0s for the same `team_scope` WHERE `submitted_at` within `review_window`, THEN create `Conflict{type: competing_p0, team, stakeholders[], p0s[], detected_at, status: active}`.
*   Rule engine must be extensible, deterministic, and run on submission and on diagnostic run.
*   Active conflicts block alignment score from being Green.

### FR6: Sign-off Protocol State Machine (Task 507)
*   States: `Draft -> PendingReview -> Approved | ApprovedWithComment | Blocked -> Escalated -> Resolved | Expired`.
*   Transitions:
    *   `Approve` -> `Approved`
    *   `ApproveWithComment` -> `ApprovedWithComment` (requires comment)
    *   `Block` -> `Blocked` -> auto-triggers Escalation
*   Only `is_required_approver` can transition from PendingReview. Block requires reason.
*   48hr rule: If >48h in PendingReview without transition, flag overdue and trigger reminder, Q4 becomes Yes.

### FR7: Escalation Path and Reminders (Task 507)
*   Escalation chains: configurable levels L1, L2, L3 per team/project with users/groups.
*   SLA: 3 days per level. On Block or timeout, escalate to next level.
*   Reminders: automated notifications at 24h and 4h before per-level deadline. Expiry after final level moves to `Expired` and notifies Diagnostic Runner.
*   All events logged to health profile.

### FR8: Reporting Dashboard & Weekly Digests (Task 508)
*   Dashboard metrics: Alignment Score (0-100), # active conflicts, # overdue sign-offs >48h, Approver Coverage %, Escalation Rate, Avg Time to Sign-off.
*   Filters by project, team, time window.
*   Weekly Digest: scheduled job generates summary per project/team including new conflicts, overdue items, escalations, and alignment trend. Delivery via email and/or Slack webhook (configurable).

## Acceptance Criteria

*   **AC-504:** 5 canonical questions defined with IDs, branching rules documented, and `HealthProfile` JSON schema defined and attached to project model spec.
*   **AC-505:** Stakeholder Map schema supports P0 submissions, required approver flag, team scope, staleness detection (30-day rule), and review_window parameter.
*   **AC-506:** Conflict rule correctly identifies case: Stakeholder A and B submit different P0s for same team within review_window -> active conflict created; same P0 or outside window -> no conflict. Unit cases specified.
*   **AC-507:** State machine diagram and transition table for sign-off includes Approve / ApproveWithComment / Block -> Escalated. SLA of 3 days per level and reminder schedule at 24h/4h specified with example timeline.
*   **AC-508:** Reporting spec defines 5+ metrics formulas and weekly digest template with fields. Digest includes at least: alignment score, active conflicts list, overdue >48h list, escalations.
*   All tasks 504-508 created with clear dependencies and linked to this PRD.

## Out of Scope

*   Actual code implementation of engine, UI components, or API endpoints (next turn).
*   Auto-resolution of P0 conflicts or AI-based priority recommendation.
*   Integration with external HRIS for org chart sync — manual stakeholder map only in v1.
*   Real-time chat, in-app commenting threads beyond ApproveWithComment.
*   Modification of categories 1-5 of Diagnostic Engine.
*   Custom escalation SLAs beyond 3-day default (configurable later).